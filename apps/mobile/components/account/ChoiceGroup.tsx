import { Pressable, Text, View } from 'react-native';
import { accountStyles as s } from './styles';

/**
 * A group of radio buttons drawn as chips (FEAT-022: vehicle, neighbourhood).
 * `aria-checked` is what a radio says on a phone and in a browser (RN-web
 * ignores `accessibilityState`).
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  error,
  onChange,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly value: T | null;
  readonly error?: string | undefined;
  readonly onChange: (value: T) => void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.id)}
              style={[s.chip, selected ? s.chipSelected : null]}
            >
              <Text style={[s.chipLabel, selected ? s.chipLabelSelected : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text style={s.fieldError} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
