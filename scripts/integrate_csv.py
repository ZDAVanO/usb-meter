"""
CSV energy and capacity integrator for USB meter log data.
Integrates power (W) and current (A) over time to compute Wh and mAh,
and compares the result with the hardware meter's recorded values.
"""

import sys
import csv
from datetime import datetime
from pathlib import Path


def parse_timestamp(value: str) -> float:
    """Parse ISO timestamp or numeric epoch into epoch seconds."""
    value = value.strip()
    try:
        # Try numeric timestamp (seconds or milliseconds)
        num = float(value)
        if num > 1e11:  # milliseconds
            return num / 1000.0
        return num
    except ValueError:
        pass

    # Try ISO formats
    # Python 3.11+ handles 'Z' and fractional seconds with fromisoformat
    iso_val = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(iso_val)
    return dt.timestamp()


def integrate_meter_csv(csv_path: str):
    path = Path(csv_path)
    if not path.is_file():
        print(f"Error: File not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    with path.open("r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("Error: CSV file is empty or missing headers.", file=sys.stderr)
            sys.exit(1)

        headers = [h.strip() for h in reader.fieldnames]

        has_time = "time" in headers
        has_voltage = "voltage" in headers
        has_current = "current" in headers
        has_power = "power" in headers
        has_energy = "energy" in headers
        has_capacity = "capacity" in headers

        if not has_time:
            print("Error: 'time' column is missing in CSV.", file=sys.stderr)
            sys.exit(1)

        if not (has_power or (has_voltage and has_current)):
            print("Error: CSV must contain either 'power' or ('voltage' and 'current').", file=sys.stderr)
            sys.exit(1)

        rows = []
        for row in reader:
            if not row.get("time"):
                continue
            rows.append(row)

    if len(rows) < 2:
        print(f"Error: Need at least 2 data points for integration, got {len(rows)}.", file=sys.stderr)
        sys.exit(1)

    records = []
    for r in rows:
        try:
            t = parse_timestamp(r["time"])
            v = float(r["voltage"]) if has_voltage and r.get("voltage") else 0.0
            i = float(r["current"]) if has_current and r.get("current") else 0.0

            if has_power and r.get("power"):
                p = float(r["power"])
            else:
                p = v * i

            p_calc = v * i if (has_voltage and has_current) else p
            meter_energy = float(r["energy"]) if has_energy and r.get("energy") else None
            meter_capacity = float(r["capacity"]) if has_capacity and r.get("capacity") else None

            records.append({
                "time": t,
                "voltage": v,
                "current": i,
                "power_reported": p,
                "power_calculated": p_calc,
                "meter_energy": meter_energy,
                "meter_capacity": meter_capacity,
            })
        except Exception:
            continue

    if len(records) < 2:
        print("Error: Less than 2 valid rows could be parsed.", file=sys.stderr)
        sys.exit(1)

    # Sort chronologically by time
    records.sort(key=lambda x: x["time"])

    total_wh_reported_power = 0.0
    total_wh_calc_power = 0.0
    total_mah = 0.0
    total_duration_sec = 0.0
    time_gaps_count = 0

    for idx in range(1, len(records)):
        prev = records[idx - 1]
        curr = records[idx]

        dt = curr["time"] - prev["time"]
        if dt < 0:
            continue

        if dt > 10.0:  # gap larger than 10 seconds
            time_gaps_count += 1

        total_duration_sec += dt

        # Trapezoidal numerical integration
        # Energy: P (W) * dt (s) / 3600 = Wh
        avg_p_reported = 0.5 * (prev["power_reported"] + curr["power_reported"])
        total_wh_reported_power += (avg_p_reported * dt) / 3600.0

        avg_p_calc = 0.5 * (prev["power_calculated"] + curr["power_calculated"])
        total_wh_calc_power += (avg_p_calc * dt) / 3600.0

        # Capacity: I (A) * dt (s) * 1000 / 3600 = mAh
        avg_i = 0.5 * (prev["current"] + curr["current"])
        total_mah += (avg_i * dt * 1000.0) / 3600.0

    first_rec = records[0]
    last_rec = records[-1]

    meter_wh_diff = None
    if first_rec["meter_energy"] is not None and last_rec["meter_energy"] is not None:
        meter_wh_diff = last_rec["meter_energy"] - first_rec["meter_energy"]

    meter_mah_diff = None
    if first_rec["meter_capacity"] is not None and last_rec["meter_capacity"] is not None:
        meter_mah_diff = last_rec["meter_capacity"] - first_rec["meter_capacity"]

    hours = int(total_duration_sec // 3600)
    minutes = int((total_duration_sec % 3600) // 60)
    seconds = total_duration_sec % 60

    print("=" * 60)
    print(f"File: {path.name}")
    print(f"Total valid samples: {len(records)}")
    print(f"Elapsed time: {total_duration_sec:.1f} s ({hours:02d}:{minutes:02d}:{seconds:04.1f})")
    if time_gaps_count > 0:
        print(f"Notice: Detected {time_gaps_count} time gap(s) > 10s between readings.")
    print("=" * 60)

    print("\n--- INTEGRATED FROM SAMPLES (Trapezoidal rule) ---")
    print(f"Energy (from reported Power):     {total_wh_reported_power:.4f} Wh")
    if has_voltage and has_current:
        print(f"Energy (from Voltage * Current):  {total_wh_calc_power:.4f} Wh")
    print(f"Capacity (from Current):          {total_mah:.2f} mAh")

    print("\n--- HARDWARE METER COUNTERS ---")
    if meter_wh_diff is not None:
        print(f"Hardware Energy (reported):       {meter_wh_diff:.4f} Wh (final: {last_rec['meter_energy']:.2f} Wh, initial: {first_rec['meter_energy']:.2f} Wh)")
        err_wh = ((total_wh_reported_power - meter_wh_diff) / meter_wh_diff * 100.0) if meter_wh_diff > 0 else 0.0
        print(f"Energy Difference:                {total_wh_reported_power - meter_wh_diff:+.4f} Wh ({err_wh:+.2f}%)")
    else:
        print("Hardware Energy:                  Not present in CSV")

    if meter_mah_diff is not None:
        print(f"Hardware Capacity (reported):     {meter_mah_diff:.2f} mAh (final: {last_rec['meter_capacity']:.1f} mAh, initial: {first_rec['meter_capacity']:.1f} mAh)")
        err_mah = ((total_mah - meter_mah_diff) / meter_mah_diff * 100.0) if meter_mah_diff > 0 else 0.0
        print(f"Capacity Difference:              {total_mah - meter_mah_diff:+.2f} mAh ({err_mah:+.2f}%)")
    else:
        print("Hardware Capacity:                Not present in CSV")

    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run python scripts/integrate_csv.py <path_to_csv_file>")
        sys.exit(1)
    integrate_meter_csv(sys.argv[1])
