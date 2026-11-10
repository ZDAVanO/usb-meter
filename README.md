# USB BLE Power Meter

## Information

This webapp makes use of [WebBluetooth](https://web.dev/bluetooth/) to read data
from cheap Atorch power meters. Any web browser with WebBluetooth support
should work, including Chrome-based browsers on desktop and Android.

## Key Differences

- **Session Persistence** — Data is saved in IndexedDB and survives page reloads.
- **Improved Graph** — Dark theme, interactive zoom/pan, and time-range filters.
- **Live Tab Title** — Shows real-time power, voltage, and current in the browser tab.
- **Background Logging** — Screen Wake Lock and clean disconnect handling on the chart.

## Screenshots

<img width="846" alt="screenshot" src="https://user-images.githubusercontent.com/164192/192336525-22cdd0de-6e44-452f-af97-06c34b4559b4.png">

### Hardware

![image](https://user-images.githubusercontent.com/164192/192333803-254ac224-3aea-4b4d-8908-5ecca27195f1.png)

This works with most power meters made by Atorch and hardware supported by the E-test app (tested with `Atorch J7-C` and `DL24`).

## Building

```shell
pnpm install
pnpm run build
```

## References & Credits

* Fork of [lanrat/usb-meter](https://github.com/lanrat/usb-meter)
* Protocol details: <https://github.com/NiceLabs/atorch-console/blob/master/docs/protocol-design.md>
* DL24 ESPHome implementation: <https://github.com/syssi/esphome-atorch-dl24>
