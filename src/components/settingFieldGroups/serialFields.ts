import type { SettingFieldDef } from '../settingFields';

export const serialFields: SettingFieldDef[] = [
{
    category: 'serial',
    field: 'defaultBaudRate',
    labelKey: 'settingDefaultBaudRate',
    descKey: 'settingDefaultBaudRateDesc',
    control: {
      kind: 'select',
      options: [
        { value: 9600, label: '9600' },
        { value: 19200, label: '19200' },
        { value: 38400, label: '38400' },
        { value: 57600, label: '57600' },
        { value: 115200, label: '115200' },
        { value: 230400, label: '230400' },
        { value: 460800, label: '460800' },
        { value: 921600, label: '921600' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultDataBits',
    labelKey: 'settingDefaultDataBits',
    descKey: 'settingDefaultDataBitsDesc',
    control: {
      kind: 'select',
      options: [
        { value: 7, label: '7' },
        { value: 8, label: '8' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultParity',
    labelKey: 'settingDefaultParity',
    descKey: 'settingDefaultParityDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'odd', label: 'Odd' },
        { value: 'even', label: 'Even' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultStopBits',
    labelKey: 'settingDefaultStopBits',
    descKey: 'settingDefaultStopBitsDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'one', label: '1' },
        { value: 'two', label: '2' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultFlowControl',
    labelKey: 'settingDefaultFlowControl',
    descKey: 'settingDefaultFlowControlDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'software', label: 'Software' },
        { value: 'hardware', label: 'Hardware' },
      ],
    },
  },
];
