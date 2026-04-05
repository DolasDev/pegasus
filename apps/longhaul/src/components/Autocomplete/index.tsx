import React, { useState, useEffect } from 'react';
import Downshift from 'downshift';
import styles from './Autocomplete.module.css';
import { InputField } from '../InputField';

interface AutocompleteOption {
  label: string;
  value?: any;
  key?: any;
}

const Item = React.forwardRef<HTMLLIElement, any>(({ classNames, ...props }, ref) => (
  <li className={`${styles.item} ${classNames}`} ref={ref} {...props} />
));

const Menu = React.forwardRef<HTMLUListElement, any>(({ classNames, ...props }, ref) => (
  <ul className={`${styles.menu} ${classNames}`} ref={ref} {...props} />
));

function defaultFilterFunction(value: string, options: AutocompleteOption[]): AutocompleteOption[] {
  return options.filter((option: AutocompleteOption) => option.label.toLowerCase().includes(value?.toLowerCase()));
}

function noop(..._args: any[]): void {}

interface AutocompleteProps {
  options?: AutocompleteOption[];
  filterFunction?: (value: string, options: AutocompleteOption[]) => AutocompleteOption[];
  onChange?: (value: any) => void;
  value?: any;
}

export function Autocomplete({
  options = [],
  filterFunction = defaultFilterFunction,
  onChange = noop,
  value: selectedItem,
}: AutocompleteProps) {
  const [value, changeValue] = useState("");
  const filteredOptions = filterFunction(value, options);
  const handleStateChange = (changes: any) => {
    if (changes.hasOwnProperty('selectedItem')) {
      //changeValue(changes.selectedItem?.label);
      onChange(changes.selectedItem || {});
    } else if (changes.hasOwnProperty("inputValue")) {
      if (!changes.inputValue) {
        onChange(null);
      } else {
        changeValue(changes.inputValue);
      }
    }
  };


  useEffect(() => {
      changeValue(selectedItem && selectedItem.label ? selectedItem.label: '');
  }, [selectedItem]);


  return (
    <Downshift selectedItem={value} onStateChange={handleStateChange}>
      {({ getInputProps, getMenuProps, getItemProps, isOpen, selectedItem, highlightedIndex }: any) => (
        <div>
          <div className={styles.container}>
            <InputField
              {...getInputProps({
                placeholder: getInputProps.placeholder || 'Enter a name',

              })}
            />
          </div>
          <div className={styles.menuContainer}>
            <Menu
              {...getMenuProps({
                refKey: 'ref',
                classNames: isOpen ? styles.isOpen : '',
              })}
            >
              {isOpen
                ? filteredOptions.map((item: AutocompleteOption, index: number) => (
                    <Item
                      key={index}
                      {...getItemProps({
                        key: index,
                        item,
                        index,
                        classNames: `${highlightedIndex === index ? styles.isActive : ''} ${
                          selectedItem === item ? styles.isSelected : ''
                        }`,
                      })}
                    >
                      {item.label}
                    </Item>
                  ))
                : null}
            </Menu>
          </div>
        </div>
      )}
    </Downshift>
  );
}

export default Autocomplete;
