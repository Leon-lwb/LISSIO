import type { SettingFieldDef } from '../settingFields';

export const notificationsFields: SettingFieldDef[] = [
{
    category: 'notifications',
    field: 'enabled',
    labelKey: 'settingNotifEnabled',
    descKey: 'settingNotifEnabledDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'notifications',
    field: 'duration',
    labelKey: 'settingNotifDuration',
    descKey: 'settingNotifDurationDesc',
    control: { kind: 'number', min: 0, max: 60000, step: 500 },
  },
  {
    category: 'notifications',
    field: 'showOnConnect',
    labelKey: 'settingNotifShowOnConnect',
    descKey: 'settingNotifShowOnConnectDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'notifications',
    field: 'showOnDisconnect',
    labelKey: 'settingNotifShowOnDisconnect',
    descKey: 'settingNotifShowOnDisconnectDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'notifications',
    field: 'showOnError',
    labelKey: 'settingNotifShowOnError',
    descKey: 'settingNotifShowOnErrorDesc',
    control: { kind: 'toggle' },
  },
];
