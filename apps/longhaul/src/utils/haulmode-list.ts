interface SelectOption {
  label: string;
  value: string;
}

export const HAULMODE_LIST: SelectOption[] = [
  {
    label: 'Self',
    value: 'Y',
  },
  {
    label: 'Atlas',
    value: 'N',
  },
  {
    label: 'Other',
    value: 'O',
  },
  {
    label: 'Undecided',
    value: 'U',
  },
  {
    label: 'Pending',
    value: 'P',
  },
];
