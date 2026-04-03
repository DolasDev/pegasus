import React, { useState, useEffect } from 'react';
import Downshift from 'downshift';
import styles from './Autocomplete.module.css';
import { InputField } from '../InputField';
import startCase from "lodash/startCase";
import toLower from "lodash/toLower";

const Item = React.forwardRef(({ classNames, ...props }, ref) => (
  <li className={`${styles.item} ${classNames}`} ref={ref} {...props} />
));

const Menu = React.forwardRef(({ classNames, ...props }, ref) => (
  <ul className={`${styles.menu} ${classNames}`} ref={ref} {...props} />
));

function defaultFilterFunction(value, options) {
  return options.filter((option) => option.label.toLowerCase().includes(value?.toLowerCase()));
}

function noop() {}

export function Autocomplete({
  options = [],
  filterFunction = defaultFilterFunction,
  onChange = noop,
  value: selectedItem,
}) {
  const [value, changeValue] = useState("");
  const filteredOptions = filterFunction(value, options);
  const handleStateChange = (changes) => {
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
      {({ getInputProps, getMenuProps, getItemProps, isOpen, selectedItem, highlightedIndex }) => (
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
                ? filteredOptions.map((item, index) => (
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
