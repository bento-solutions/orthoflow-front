import { describe, expect, it } from 'vitest';
import { notificationLink } from './notification.service';

describe('notificationLink', () => {
  it('leads each kind of notification to the screen that deals with it', () => {
    expect(notificationLink('TASK', 't1')).toBe('/tasks');
    expect(notificationLink('LAB_ORDER', 'l1')).toBe('/lab-orders');
    expect(notificationLink('BOOKING_REQUEST', 'b1')).toBe('/booking');
    expect(notificationLink('PENDING_PATIENT', 'p1')).toBe('/booking');
    expect(notificationLink('CHEQUE', 'c1')).toBe('/finance/cheques');
    expect(notificationLink('STAFF_THREAD', 'm1')).toBe('/messages');
    expect(notificationLink('APPOINTMENT', 'a1')).toBe('/schedule');
  });

  it('opens the very cycle a failed sterilization control is about', () => {
    expect(notificationLink('STERILIZATION_CYCLE', 'c-9')).toBe('/sterilization/cycles/c-9');
    expect(notificationLink('STERILIZATION_CYCLE', null)).toBe('/sterilization');
  });

  it('goes nowhere for something it does not know', () => {
    expect(notificationLink('SOMETHING_NEW', 'x')).toBeNull();
    expect(notificationLink(null, null)).toBeNull();
  });
});
