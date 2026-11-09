// DOM elements
const goButton = document.getElementById("go")!;
const pauseElem = document.getElementById("pause")!;

// dialog
const dialogElem = document.getElementById('dialog')! as HTMLDialogElement;
const dialogMessageElem = document.getElementById('dialogError')!;
const warnBlockElem = document.getElementById("warnBlock")!;

// table values
const voltageElem = document.getElementById("voltage")!;
const currentElem = document.getElementById("current")!;
const powerElem = document.getElementById("power")!;
const energyElem = document.getElementById("energy")!;
const capacityElem = document.getElementById("capacity")!;
const resistanceElem = document.getElementById("resistance")!;
const temperatureElem = document.getElementById("temperature")!;
const timeElem = document.getElementById("time")!;
const usbElem = document.getElementById("usb")!;

// table stats
const voltageStatsElem = document.getElementById("voltage_stats")!;
const currentStatsElem = document.getElementById("current_stats")!;
const powerStatsElem = document.getElementById("power_stats")!;
const energyStatsElem = document.getElementById("energy_stats")!;
const capacityStatsElem = document.getElementById("capacity_stats")!;
const resistanceStatsElem = document.getElementById("resistance_stats")!;
const temperatureStatsElem = document.getElementById("temperature_stats")!;
const timeStatsElem = document.getElementById("time_stats")!;
const usbStatsElem = document.getElementById("usb_stats")!;

const graphDiv = 'graph';

interface StateData {
    last_: Packet | null;
    history: Packet[];
    started: Date | null;
    stats: {
        min: { [key: string]: number };
        max: { [key: string]: number };
        average: { [key: string]: number };
        sum: { [key: string]: number };
        count: { [key: string]: number };
    };
}

const BASE_TITLE = "USB BLE Power Meter";

class WakeLockManager {
    private sentinel: any = null;

    isActive(): boolean {
        return this.sentinel !== null && !this.sentinel.released;
    }

    async request(): Promise<void> {
        if (!('wakeLock' in navigator)) {
            document.title = `🟢 ${BASE_TITLE}`;
            return;
        }
        try {
            this.sentinel = await (navigator as any).wakeLock.request('screen');
            this.sentinel.addEventListener('release', () => {
                this.sentinel = null;
                if (!state.meter.running) {
                    document.title = BASE_TITLE;
                }
            });
            document.title = `🟢 ${BASE_TITLE}`;
        } catch (err) {
            console.warn('Wake Lock request failed:', err);
            document.title = `🟢 ${BASE_TITLE}`;
        }
    }

    async release(): Promise<void> {
        if (this.sentinel) {
            try {
                await this.sentinel.release();
            } catch (err) {
                console.warn('Wake Lock release error:', err);
            }
            this.sentinel = null;
        }
        document.title = BASE_TITLE;
    }
}

const wakeLock = new WakeLockManager();
const storage = new MeterStorage();

class state {
    private constructor() { }

    static meter = new Meter();
    static data_paused = false;
    static data: StateData = {} as StateData;

    // Support 24+ hours at 1 sample/sec
    static max_data = 100000;

    // Buffer points while document is hidden to optimize CPU
    static pendingPoints: Packet[] = [];

    static readonly NUMERIC_PROPERTIES = [
        "voltage",
        "current",
        "power",
        "energy",
        "capacity",
        "resistance",
        "temp",
        "data1",
        "data2"
    ];

    static async stop(e: Event) {
        console.log("state stop");
        goButton.innerText = "Connect";
        await wakeLock.release();
    }

    static async start(device: BluetoothDevice) {
        console.log("state start");
        goButton.innerText = "Disconnect";
        if (!this.data.started) {
            this.data.started = new Date();
        }
        await wakeLock.request();
    }

    static reset() {
        this.last = null;
        this.data.history = [];
        this.pendingPoints = [];
        this.data.started = null;
        this.data.stats = {
            min: {},
            max: {},
            average: {},
            sum: {},
            count: {},
        };
    }

    static async add(p: Packet) {
        if (this.data_paused) {
            return;
        }

        if (!p) {
            console.error("got empty packet");
            return;
        }

        // Chronological append
        this.data.history.push(p);
        if (this.data.history.length > this.max_data) {
            this.data.history.shift();
        }

        this.updateStats(p);
        this.last = p;

        // Persist point to IndexedDB
        storage.addRecord(p.toRecord()).catch(err => console.error("Storage write error:", err));

        // When tab is hidden, buffer points to prevent expensive background canvas draws
        if (document.hidden) {
            this.pendingPoints.push(p);
        } else {
            if (this.pendingPoints.length > 0) {
                const batch = this.pendingPoints.concat(p);
                this.pendingPoints = [];
                this.flushPointsToPlot(batch);
            } else {
                this.flushPointsToPlot([p]);
            }
        }
    }

    static flushPendingPoints() {
        if (this.pendingPoints.length === 0) return;
        const batch = this.pendingPoints;
        this.pendingPoints = [];
        this.flushPointsToPlot(batch);
    }

    static flushPointsToPlot(points: Packet[]) {
        if (points.length === 0) return;
        const xValues = points.map(pt => pt.time);
        const yValues = [
            points.map(pt => pt.voltage),
            points.map(pt => pt.current),
            points.map(pt => pt.power),
            points.map(pt => pt.energy),
            points.map(pt => pt.capacity),
            points.map(pt => pt.resistance),
            points.map(pt => pt.temp),
            points.map(pt => pt.data1),
            points.map(pt => pt.data2),
        ];

        Plotly.extendTraces(
            graphDiv,
            {
                y: yValues,
                x: new Array(yValues.length).fill(xValues),
            },
            [0, 1, 2, 3, 4, 5, 6, 7, 8],
            this.max_data
        );
    }

    static updateStats(p: Packet) {
        for (const prop of this.NUMERIC_PROPERTIES) {
            const val = p[prop];
            if (typeof val !== 'number' || !Number.isFinite(val)) {
                continue;
            }
            if (typeof this.data.stats.max[prop] === 'undefined' || val > this.data.stats.max[prop]) {
                this.data.stats.max[prop] = val;
            }
            if (typeof this.data.stats.min[prop] === 'undefined' || val < this.data.stats.min[prop]) {
                this.data.stats.min[prop] = val;
            }
            if (typeof this.data.stats.sum[prop] === 'undefined') {
                this.data.stats.sum[prop] = 0;
                this.data.stats.count[prop] = 0;
            }
            this.data.stats.sum[prop] += val;
            this.data.stats.count[prop] += 1;
            const newAverage = this.data.stats.sum[prop] / this.data.stats.count[prop];
            this.data.stats.average[prop] = Math.round(newAverage * 100) / 100;
        }
    }

    static get last(): Packet | null {
        return this.data.last_;
    }

    static set last(p: Packet | null) {
        this.data.last_ = p;
        if (p) {
            // data
            voltageElem.innerText = `${p.voltage} V`;
            currentElem.innerText = `${p.current} A`;
            powerElem.innerText = `${p.power} W`;
            energyElem.innerText = `${p.energy} Wh`;
            capacityElem.innerText = `${p.capacity} mAh`;
            resistanceElem.innerText = `${p.resistance} Ω`;
            temperatureElem.innerText = `${p.temp} °C / ${cToF(p.temp)} °F`;
            usbElem.innerText = `${p.data1}/${p.data2} V`;
            timeElem.innerText = `${p.duration}`;

            // stats
            voltageStatsElem.innerText = `${this.data.stats.min.voltage ?? '-'} / ${this.data.stats.max.voltage ?? '-'} / ${this.data.stats.average.voltage ?? '-'}`;
            currentStatsElem.innerText = `${this.data.stats.min.current ?? '-'} / ${this.data.stats.max.current ?? '-'} / ${this.data.stats.average.current ?? '-'}`;
            powerStatsElem.innerText = `${this.data.stats.min.power ?? '-'} / ${this.data.stats.max.power ?? '-'} / ${this.data.stats.average.power ?? '-'}`;
            energyStatsElem.innerText = `${this.data.stats.min.energy ?? '-'} / ${this.data.stats.max.energy ?? '-'} / ${this.data.stats.average.energy ?? '-'}`;
            capacityStatsElem.innerText = `${this.data.stats.min.capacity ?? '-'} / ${this.data.stats.max.capacity ?? '-'} / ${this.data.stats.average.capacity ?? '-'}`;
            resistanceStatsElem.innerText = `${this.data.stats.min.resistance ?? '-'} / ${this.data.stats.max.resistance ?? '-'} / ${this.data.stats.average.resistance ?? '-'}`;
            temperatureStatsElem.innerText = `${this.data.stats.min.temp ?? '-'} / ${this.data.stats.max.temp ?? '-'} / ${this.data.stats.average.temp ?? '-'}`;
            usbStatsElem.innerText = `(${this.data.stats.min.data1 ?? '-'}/${this.data.stats.min.data2 ?? '-'}) / (${this.data.stats.max.data1 ?? '-'}/${this.data.stats.max.data2 ?? '-'}) / (${this.data.stats.average.data1 ?? '-'}/${this.data.stats.average.data2 ?? '-'})`;
            timeStatsElem.innerText = `Samples: ${this.data.history.length}`;

            if (p.type == DEVICE_TYPE.DC) {
                usbElem.innerText = 'N/A';
                usbStatsElem.innerText = 'N/A';
                energyElem.innerText = 'N/A';
                energyStatsElem.innerText = 'N/A';
            }

            if (this.meter.running) {
                document.title = `🟢 ${p.voltage.toFixed(2)}V ${p.current.toFixed(2)}A | ${BASE_TITLE}`;
            }
        } else {
            console.log("clearing state");
            document.title = BASE_TITLE;
            voltageElem.innerText = '';
            currentElem.innerText = '';
            powerElem.innerText = '';
            energyElem.innerText = '';
            capacityElem.innerText = '';
            resistanceElem.innerText = '';
            temperatureElem.innerText = '';
            usbElem.innerText = '';
            timeElem.innerText = '000:00:00';

            voltageStatsElem.innerText = '';
            currentStatsElem.innerText = '';
            powerStatsElem.innerText = '';
            energyStatsElem.innerText = '';
            capacityStatsElem.innerText = '';
            resistanceStatsElem.innerText = '';
            temperatureStatsElem.innerText = '';
            usbStatsElem.innerText = '';
            timeStatsElem.innerText = 'Samples: 0';
        }
    }
}

function showError(msg: string) {
    dialogMessageElem.innerText = msg;
    dialogElem.showModal();
}

function cToF(cTemp: number): number {
    return cTemp * 9 / 5 + 32;
}

async function Go() {
    if (state.meter.running) {
        console.log("stopping");
        await state.meter.disconnect();
        await wakeLock.release();
    } else {
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{
                    services: [UUID_SERVICE]
                }]
            });
            goButton.innerText = "Starting....";
            console.log("got device: ", device.name, device.id);
            await state.meter.start(device);
            await wakeLock.request();
        } catch (error) {
            console.error("Bluetooth connection error: ", error);
            goButton.innerText = "Connect";
            showError(String(error));
        }
    }
}

function Pause() {
    state.data_paused = !state.data_paused;
    if (state.data_paused) {
        pauseElem.innerText = "Resume";
    } else {
        pauseElem.innerText = "Pause";
    }
}

async function ResetMeter() {
    if (!state.meter.running) {
        showError("Meter is not connected. Please connect first.");
        return;
    }
    if (!confirm("Send reset command to meter hardware? This will reset mAh, Wh and timer on the device.")) {
        return;
    }
    try {
        console.log("Sending reset command to meter hardware...");
        await state.meter.reset();
    } catch (err) {
        console.error("Meter hardware reset error:", err);
        showError(`Failed to reset meter: ${String(err)}`);
    }
}

async function ClearData() {
    if (!confirm("Are you sure you want to clear the graph and all recorded session data?")) {
        return;
    }
    console.log("Clearing graph and recorded session data...");
    state.reset();
    await storage.clear();
    initPlot();
}

function Reset() {
    ClearData();
}

function initPlot(initialPackets?: Packet[]) {
    const layout = {
        autosize: true,
        showlegend: true,
        automargin: true,
    };

    const config = {
        displaylogo: false,
        responsive: true,
    };

    const xData = initialPackets && initialPackets.length > 0 ? initialPackets.map(p => p.time) : [];
    const getY = (fn: (p: Packet) => number | null) => (initialPackets && initialPackets.length > 0 ? initialPackets.map(fn) : []);

    Plotly.newPlot(graphDiv, [
        {
            name: "Volts",
            y: getY(p => p.voltage),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'darkRed' },
        },
        {
            name: "Current",
            y: getY(p => p.current),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'green' },
        },
        {
            name: "Power",
            y: getY(p => p.power),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'red' },
        },
        {
            name: "Energy",
            y: getY(p => p.energy),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'purple' },
            visible: 'legendonly',
        },
        {
            name: "Capacity",
            y: getY(p => p.capacity),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'lightblue' },
            visible: 'legendonly',
        },
        {
            name: "Resistance",
            y: getY(p => p.resistance),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'blue' },
            visible: 'legendonly',
        },
        {
            name: "Temperature",
            y: getY(p => p.temp),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'turquoise' },
        },
        {
            name: "USB D-",
            y: getY(p => p.data1),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'lightGreen' },
            visible: 'legendonly',
        },
        {
            name: "USB D+",
            y: getY(p => p.data2),
            x: xData,
            type: 'scattergl',
            mode: 'lines',
            line: { color: 'lightGreen' },
            visible: 'legendonly',
        },
    ], layout, config);
}

function Save() {
    if (!state.last || state.data.history.length === 0) {
        showError("No data yet to save");
        return;
    }
    const csvColumns: Array<string> = [
        "time",
        "voltage",
        "current",
        "power",
        "resistance",
        "capacity",
        "energy",
        "data1",
        "data2",
        "temp",
        "duration"
    ];

    const headers = csvColumns.filter(col => state.last && state.last[col] !== undefined);
    const rows: string[] = [headers.join(",")];

    for (const p of state.data.history) {
        const row = headers.map(h => {
            const val = p[h];
            if (val instanceof Date) {
                return val.toISOString();
            }
            return val !== null && val !== undefined ? String(val) : "";
        });
        rows.push(row.join(","));
    }

    const csvContent = rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const filename = `meter-data-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
    if ("bluetooth" in navigator) {
        warnBlockElem.hidden = true;
    } else {
        showError("WebBluetooth does not seem to be supported by this device");
    }

    // Setup UI callbacks
    state.meter.onPacketCallback = state.add.bind(state);
    state.meter.onDisconnectCallback = state.stop.bind(state);
    state.meter.onStartCallback = state.start.bind(state);

    // Background tab optimizations: flush queued points and restore wake lock if tab becomes active
    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden) {
            state.flushPendingPoints();
            if (state.meter.running && !wakeLock.isActive()) {
                await wakeLock.request();
            }
        }
    });

    // Initialize database and load persisted session data
    try {
        await storage.init();
        const records = await storage.getAllRecords();
        if (records.length > 0) {
            console.log(`Restoring ${records.length} samples from previous session...`);
            const packets = records.map(rec => Packet.fromRecord(rec));
            state.reset();
            state.data.history = packets;
            for (const pt of packets) {
                state.updateStats(pt);
            }
            state.last = packets[packets.length - 1];
            initPlot(packets);
            return;
        }
    } catch (err) {
        console.error("Failed to restore session from storage:", err);
    }

    // Default empty plot
    state.reset();
    initPlot();
});
