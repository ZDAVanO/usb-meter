# USB BLE Power Meter

## Information

This webapp makes use of [WebBluetooth](https://web.dev/bluetooth/) to read data
from cheap Atorch power meters. Any web browser with WebBluetooth support
should work, including Chrome-based browsers on desktop and Android.

## Features

- **Long-term logging (24h+)**: hardware-accelerated WebGL rendering (`scattergl`) capable of holding 100,000+ data points smoothly.
- **IndexedDB persistence**: data is saved in your browser storage and automatically restored after page reloads (F5).
- **Background tab support**: throttles heavy canvas redraws when the tab is hidden and flushes queued points upon return.
- **Screen Wake Lock**: keeps the system awake during active testing and shows a status indicator in the tab title (`🟢`).
- **Disconnection gap handling**: automatically creates visual breaks on the chart when the device is disconnected or paused.
- **Separate Controls**: dedicated buttons for hardware meter reset and clearing web session data.
- **CSV Export**: fast chronological download via Blobs.

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
