import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge Snapshot Tests', () => {
  it('should match snapshot for pending status', () => {
    const { toJSON } = render(<StatusBadge status="pending" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('should match snapshot for in_transit status', () => {
    const { toJSON } = render(<StatusBadge status="in_transit" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('should match snapshot for delivered status', () => {
    const { toJSON } = render(<StatusBadge status="delivered" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('should match snapshot for cancelled status', () => {
    const { toJSON } = render(<StatusBadge status="cancelled" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('should match snapshot for large size', () => {
    const { toJSON } = render(<StatusBadge status="pending" size="large" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
