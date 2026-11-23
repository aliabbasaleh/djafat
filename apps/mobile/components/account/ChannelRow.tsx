import { Pressable, Text, View } from 'react-native';
import type { CodeChannelId } from '@djafat/sdk';
import type { ChannelButton } from '../../lib/account';
import { accountStyles as s } from './styles';

interface ChannelRowProps {
  readonly buttons: readonly ChannelButton[];
  readonly label: string;
  readonly selected?: CodeChannelId | undefined;
  readonly onSelect: (button: ChannelButton) => void;
}

/** E-mail, WhatsApp, SMS — a channel the server does not offer yet says « Bientôt disponible ». */
export function ChannelRow({ buttons, label, selected, onSelect }: ChannelRowProps) {
  return (
    <View style={s.channels} accessibilityLabel={label}>
      {buttons.map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          accessibilityState={{ disabled: !b.enabled, selected: selected === b.id }}
          accessibilityLabel={b.note ? `${b.label}, ${b.note}` : b.label}
          disabled={!b.enabled}
          onPress={() => onSelect(b)}
          style={[
            s.channel,
            !b.enabled && s.channelDisabled,
            selected === b.id && s.channelSelected,
          ]}
        >
          <Text style={[s.channelLabel, !b.enabled && s.channelLabelDisabled]}>
            {b.icon} {b.label}
          </Text>
          {b.note ? <Text style={s.channelNote}>{b.note}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}
