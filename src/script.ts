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

function updateConnectionUI(status: 'disconnected' | 'connecting' | 'connected') {
    goButton.classList.remove('btn-connected', 'btn-disconnected', 'btn-connecting');
    if (status === 'connected') {
        goButton.innerText = "Disconnect";
        goButton.classList.add('btn-connected');
    } else if (status === 'connecting') {
        goButton.innerText = "Connecting...";
        goButton.classList.add('btn-connecting');
    } else {
        goButton.innerText = "Connect";
        goButton.classList.add('btn-disconnected');
    }
}

class WakeLockManager {
    private sentinel: any = null;

    isActive(): boolean {
        return this.sentinel !== null && !this.sentinel.released;
    }

    async request(): Promise<void> {
        if (!('wakeLock' in navigator)) {
            return;
        }
        try {
            this.sentinel = await (navigator as any).wakeLock.request('screen');
            this.sentinel.addEventListener('release', () => {
                this.sentinel = null;
            });
        } catch (err) {
            console.warn('Wake Lock request failed:', err);
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
    }
}

const wakeLock = new WakeLockManager();
const storage = new MeterStorage();

interface PlotPoint {
    time: Date;
    voltage: number | null;
    current: number | null;
    power: number | null;
    energy: number | null;
    capacity: number | null;
    resistance: number | null;
    temp: number | null;
    data1: number | null;
    data2: number | null;
}

const GAP_THRESHOLD_MS = 5000; // 5 seconds threshold to detect disconnect / pause

class state {
    private constructor() { }

    static meter = new Meter();
    static data_paused = false;
    static data: StateData = {} as StateData;

    // Support 24+ hours at 1 sample/sec
    static max_data = 100000;

    // Buffer points while document is hidden to optimize CPU
    static pendingPoints: PlotPoint[] = [];
    static disconnected = false;

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
        updateConnectionUI('disconnected');
        this.disconnected = true;
        await wakeLock.release();
        document.title = BASE_TITLE;
    }

    static async start(device: BluetoothDevice) {
        console.log("state start");
        updateConnectionUI('connected');
        if (!this.data.started) {
            this.data.started = new Date();
        }
        await wakeLock.request();
    }

    static reset() {
        this.last = null;
        this.data.history = [];
        this.pendingPoints = [];
        this.disconnected = false;
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

        // Check for gap (disconnect or > 5s interruption) to create a visual break on plot
        if (this.last) {
            const timeDiff = p.time.getTime() - this.last.time.getTime();
            if (timeDiff > GAP_THRESHOLD_MS || this.disconnected) {
                const gapPoint: PlotPoint = {
                    time: new Date(this.last.time.getTime() + 1000),
                    voltage: null,
                    current: null,
                    power: null,
                    energy: null,
                    capacity: null,
                    resistance: null,
                    temp: null,
                    data1: null,
                    data2: null,
                };
                if (document.hidden) {
                    this.pendingPoints.push(gapPoint);
                } else {
                    this.flushPlotPoints([gapPoint]);
                }
            }
        }
        this.disconnected = false;

        // Chronological append
        this.data.history.push(p);
        if (this.data.history.length > this.max_data) {
            this.data.history.shift();
        }

        this.updateStats(p);
        this.last = p;

        // Persist point to IndexedDB
        storage.addRecord(p.toRecord()).catch(err => console.error("Storage write error:", err));

        const livePoint: PlotPoint = {
            time: p.time,
            voltage: p.voltage,
            current: p.current,
            power: p.power,
            energy: p.energy,
            capacity: p.capacity,
            resistance: p.resistance,
            temp: p.temp,
            data1: p.data1,
            data2: p.data2,
        };

        // When tab is hidden, buffer points to prevent expensive background canvas draws
        if (document.hidden) {
            this.pendingPoints.push(livePoint);
        } else {
            if (this.pendingPoints.length > 0) {
                const batch = this.pendingPoints.concat(livePoint);
                this.pendingPoints = [];
                this.flushPlotPoints(batch);
            } else {
                this.flushPlotPoints([livePoint]);
            }
        }
    }

    static flushPendingPoints() {
        if (this.pendingPoints.length === 0) return;
        const batch = this.pendingPoints;
        this.pendingPoints = [];
        this.flushPlotPoints(batch);
    }

    static flushPlotPoints(points: PlotPoint[]) {
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

        if (currentWindowSeconds > 0 && !isUserPanning && points.length > 0) {
            const latest = points[points.length - 1];
            const nowTime = latest.time instanceof Date
                ? latest.time.getTime()
                : new Date(latest.time).getTime();
            const startTime = nowTime - (currentWindowSeconds * 1000);
            const startDate = new Date(startTime);
            const endDate = new Date(nowTime);
            isApplyingWindow = true;
            Plotly.relayout(graphDiv, {
                'xaxis.autorange': false,
                'xaxis.range': [formatDateForPlotly(startDate), formatDateForPlotly(endDate)],
            }).then(() => {
                isApplyingWindow = false;
            }).catch(() => {
                isApplyingWindow = false;
            });
        }
    }

    static readonly CUMULATIVE_PROPERTIES = ["energy", "capacity"];

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
            // Energy and capacity accumulate monotonically, so calculating an average has no physical meaning
            if (this.CUMULATIVE_PROPERTIES.indexOf(prop) !== -1) {
                continue;
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
            const activeAvgPower = (p.durationSeconds > 0 && p.energy > 0)
                ? (Math.round((p.energy / (p.durationSeconds / 3600)) * 100) / 100).toFixed(2)
                : '-';
            voltageStatsElem.innerText = `${this.data.stats.min.voltage ?? '-'} / ${this.data.stats.max.voltage ?? '-'} / ${this.data.stats.average.voltage ?? '-'}`;
            currentStatsElem.innerText = `${this.data.stats.min.current ?? '-'} / ${this.data.stats.max.current ?? '-'} / ${this.data.stats.average.current ?? '-'}`;
            powerStatsElem.innerText = `${this.data.stats.min.power ?? '-'} / ${this.data.stats.max.power ?? '-'} / ${this.data.stats.average.power ?? '-'} (active: ${activeAvgPower})`;
            energyStatsElem.innerText = `${this.data.stats.min.energy ?? '-'} / ${this.data.stats.max.energy ?? '-'}`;
            capacityStatsElem.innerText = `${this.data.stats.min.capacity ?? '-'} / ${this.data.stats.max.capacity ?? '-'}`;
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
                // const formattedPower = p.power < 10 ? p.power.toFixed(1) : Math.round(p.power);
                // document.title = `${formattedPower}W ${p.voltage.toFixed(1)}V ${p.current.toFixed(2)}A | ${BASE_TITLE}`;
                document.title = `${p.power.toFixed(2)}W ${p.voltage.toFixed(2)}V ${p.current.toFixed(2)}A | ${BASE_TITLE}`;
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
        updateConnectionUI('disconnected');
        document.title = BASE_TITLE;
    } else {
        try {
            updateConnectionUI('connecting');
            const device = await navigator.bluetooth.requestDevice({
                filters: [{
                    services: [UUID_SERVICE]
                }]
            });
            console.log("got device: ", device.name, device.id);
            await state.meter.start(device);
            await wakeLock.request();
        } catch (error: any) {
            updateConnectionUI('disconnected');
            if (error?.name === 'NotFoundError' || error?.name === 'AbortError' || String(error).includes('cancelled') || String(error).includes('canceled')) {
                console.log("Device chooser cancelled by user.");
                return;
            }
            console.error("Bluetooth connection error: ", error);
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

function formatDateForPlotly(d: Date): string {
    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

let currentWindowSeconds: number = 0; // 0 = All
let isUserPanning: boolean = false;
let isApplyingWindow: boolean = false;

function setTimeWindow(seconds: number) {
    currentWindowSeconds = seconds;
    isUserPanning = false;

    const buttons = document.querySelectorAll<HTMLButtonElement>('.time-range-btn');
    buttons.forEach(btn => {
        const range = Number(btn.getAttribute('data-range') || '0');
        if (range === seconds) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    applyCurrentTimeWindow();
}

function applyCurrentTimeWindow() {
    if (!state.last) {
        return;
    }
    isApplyingWindow = true;
    if (currentWindowSeconds === 0) {
        Plotly.relayout(graphDiv, {
            'xaxis.autorange': true,
        }).then(() => {
            isApplyingWindow = false;
        }).catch(() => {
            isApplyingWindow = false;
        });
    } else {
        const lastPacket = (state.data.history && state.data.history.length > 0)
            ? state.data.history[state.data.history.length - 1]
            : state.last;
        const nowTime = lastPacket.time instanceof Date
            ? lastPacket.time.getTime()
            : new Date(lastPacket.time).getTime();
        const startTime = nowTime - (currentWindowSeconds * 1000);
        const startDate = new Date(startTime);
        const endDate = new Date(nowTime);
        Plotly.relayout(graphDiv, {
            'xaxis.autorange': false,
            'xaxis.range': [formatDateForPlotly(startDate), formatDateForPlotly(endDate)],
        }).then(() => {
            isApplyingWindow = false;
        }).catch(() => {
            isApplyingWindow = false;
        });
    }
}

function attachRelayoutListener() {
    const graphElem = document.getElementById(graphDiv) as any;
    if (graphElem && graphElem.on) {
        if (graphElem.removeAllListeners) {
            graphElem.removeAllListeners('plotly_relayout');
        }
        graphElem.on('plotly_relayout', (eventData: any) => {
            if (!eventData || isApplyingWindow) {
                return;
            }
            if (eventData['xaxis.autorange'] === true) {
                // User double-clicked to reset
                setTimeWindow(0);
            } else if (eventData['xaxis.range[0]'] !== undefined || eventData['xaxis.range'] !== undefined) {
                // User panned or zoomed manually
                isUserPanning = true;
                const buttons = document.querySelectorAll<HTMLButtonElement>('.time-range-btn');
                buttons.forEach(btn => btn.classList.remove('active'));
            }
        });
    }
}

async function ClearData() {
    if (!confirm("Are you sure you want to clear the graph and all recorded session data?")) {
        return;
    }
    console.log("Clearing graph and recorded session data...");
    setTimeWindow(0);
    state.reset();
    await storage.clear();
    initPlot();
}

function Reset() {
    ClearData();
}

function buildPlotSeries(packets?: Packet[]): { x: Date[]; y: (number | null)[][] } {
    const x: Date[] = [];
    const y: (number | null)[][] = [[], [], [], [], [], [], [], [], []];
    if (!packets || packets.length === 0) {
        return { x, y };
    }
    for (let i = 0; i < packets.length; i++) {
        const p = packets[i];
        if (i > 0) {
            const prev = packets[i - 1];
            if (p.time.getTime() - prev.time.getTime() > GAP_THRESHOLD_MS) {
                // Insert gap point to break lines visually
                x.push(new Date(prev.time.getTime() + 1000));
                for (let k = 0; k < 9; k++) {
                    y[k].push(null);
                }
            }
        }
        x.push(p.time);
        y[0].push(p.voltage);
        y[1].push(p.current);
        y[2].push(p.power);
        y[3].push(p.energy);
        y[4].push(p.capacity);
        y[5].push(p.resistance);
        y[6].push(p.temp);
        y[7].push(p.data1);
        y[8].push(p.data2);
    }
    return { x, y };
}

function initPlot(initialPackets?: Packet[]) {
    const layout = {
        autosize: true,
        showlegend: true,
        automargin: true,
        dragmode: 'pan' as const,
        paper_bgcolor: '#161f27',
        plot_bgcolor: '#161f27',
        font: {
            color: '#c9d1d9',
        },
        xaxis: {
            gridcolor: '#243242',
            zerolinecolor: '#243242',
            tickfont: { color: '#8b949e' },
            linecolor: '#243242',
        },
        yaxis: {
            gridcolor: '#243242',
            zerolinecolor: '#243242',
            tickfont: { color: '#8b949e' },
            linecolor: '#243242',
        },
        legend: {
            font: { color: '#c9d1d9' },
            bgcolor: 'rgba(22, 31, 39, 0.7)',
        },
        margin: {
            t: 20,
            b: 40,
            l: 45,
            r: 20,
        },
    };

    const config = {
        displaylogo: false,
        responsive: true,
        scrollZoom: true,
    };

    const series = buildPlotSeries(initialPackets);

    Plotly.newPlot(graphDiv, [
        {
            name: "Volts",
            y: series.y[0],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#ffd700' },
        },
        {
            name: "Current",
            y: series.y[1],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#4ade80' },
        },
        {
            name: "Power",
            y: series.y[2],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#ff5252' },
        },
        {
            name: "Energy",
            y: series.y[3],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#c084fc' },
            visible: 'legendonly',
        },
        {
            name: "Capacity",
            y: series.y[4],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#38bdf8' },
            visible: 'legendonly',
        },
        {
            name: "Resistance",
            y: series.y[5],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#2d6eff' },
            visible: 'legendonly',
        },
        {
            name: "Temperature",
            y: series.y[6],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#2dd4bf' },
        },
        {
            name: "USB D-",
            y: series.y[7],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#86efac' },
            visible: 'legendonly',
        },
        {
            name: "USB D+",
            y: series.y[8],
            x: series.x,
            type: 'scattergl',
            mode: 'lines',
            connectgaps: false,
            line: { color: '#34d399' },
            visible: 'legendonly',
        },
    ], layout, config).then(() => {
        applyCurrentTimeWindow();
        attachRelayoutListener();
    });
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
    updateConnectionUI('disconnected');

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
