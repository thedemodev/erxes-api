/* eslint-env jest */
/* eslint-disable no-underscore-dangle */

import { connect, disconnect } from '../db/connection';
import { Customers, InternalNotes, Conversations, ConversationMessages } from '../db/models';
import {
  fieldFactory,
  customerFactory,
  conversationMessageFactory,
  conversationFactory,
  internalNoteFactory,
} from '../db/factories';
import { COC_CONTENT_TYPES } from '../data/constants';

beforeAll(() => connect());

afterAll(() => disconnect());

describe('Customers model tests', () => {
  let _customer;

  beforeEach(async () => {
    _customer = await customerFactory();
  });

  afterEach(async () => {
    // Clearing test data
    await Customers.remove({});
  });

  test('Create customer', async () => {
    expect.assertions(5);

    // check duplication
    try {
      await Customers.createCustomer({ name: 'name', email: _customer.email });
    } catch (e) {
      expect(e.message).toBe('Duplicated email');
    }

    const doc = {
      name: 'name',
      email: 'dombo@yahoo.com',
      firstName: 'firstName',
      lastName: 'lastName',
    };

    const customerObj = await Customers.createCustomer(doc);

    expect(customerObj.name).toBe(doc.name);
    expect(customerObj.firstName).toBe(doc.firstName);
    expect(customerObj.lastName).toBe(doc.lastName);
    expect(customerObj.email).toBe(doc.email);
  });

  test('Update customer', async () => {
    expect.assertions(4);

    const previousCustomer = await customerFactory({
      email: 'dombo@yahoo.com',
    });

    const doc = {
      name: 'Dombo',
      email: 'dombo@yahoo.com',
      phone: '242442200',
    };

    // test duplication
    try {
      await Customers.updateCustomer(_customer._id, doc);
    } catch (e) {
      expect(e.message).toBe('Duplicated email');
    }

    // remove previous duplicated entry
    await Customers.remove({ _id: previousCustomer._id });

    const customerObj = await Customers.updateCustomer(_customer._id, doc);

    expect(customerObj.name).toBe(doc.name);
    expect(customerObj.email).toBe(doc.email);
    expect(customerObj.phone).toBe(doc.phone);
  });

  test('Mark customer as inactive', async () => {
    const customer = await customerFactory({
      messengerData: { isActive: true, lastSeenAt: null },
    });

    const customerObj = await Customers.markCustomerAsNotActive(customer._id);

    expect(customerObj.messengerData.isActive).toBe(false);
    expect(customerObj.messengerData.lastSeenAt).toBeDefined();
  });

  test('Add company', async () => {
    let customer = await customerFactory({});

    // call add company
    const company = await Customers.addCompany({
      _id: customer._id,
      name: 'name',
      website: 'website',
    });

    customer = await Customers.findOne({ _id: customer._id });

    expect(customer.companyIds).toEqual(expect.arrayContaining([company._id]));
  });

  test('Create customer: with customer fields validation error', async () => {
    expect.assertions(1);

    const field = await fieldFactory({ validation: 'number' });

    try {
      await Customers.createCustomer({
        name: 'name',
        email: 'dombo@yahoo.com',
        customFieldsData: { [field._id]: 'invalid number' },
      });
    } catch (e) {
      expect(e.message).toBe(`${field.text}: Invalid number`);
    }
  });

  test('Update customer: with customer fields validation error', async () => {
    expect.assertions(1);

    const field = await fieldFactory({ validation: 'number' });

    try {
      await Customers.updateCustomer(_customer._id, {
        name: 'name',
        email: 'dombo@yahoo.com',
        customFieldsData: { [field._id]: 'invalid number' },
      });
    } catch (e) {
      expect(e.message).toBe(`${field.text}: Invalid number`);
    }
  });

  test('Update customer companies', async () => {
    const companyIds = ['12313qwrqwe', '123', '11234'];

    const customerObj = await Customers.updateCompanies(_customer._id, companyIds);

    expect(customerObj.companyIds).toEqual(expect.arrayContaining(companyIds));
  });

  test('removeCustomer', async () => {
    const customer = await customerFactory({});

    await internalNoteFactory({
      contentType: COC_CONTENT_TYPES.CUSTOMER,
      contentTypeId: customer._id,
    });
    await conversationFactory({
      customerId: customer._id,
    });
    await conversationMessageFactory({
      customerId: customer._id,
    });

    await Customers.removeCustomer(customer._id);

    expect(
      await InternalNotes.find({
        contentType: COC_CONTENT_TYPES.CUSTOMER,
        contentTypeId: customer._id,
      }),
    ).toHaveLength(0);
    expect(await Conversations.find({ customerId: customer._id })).toHaveLength(0);
    expect(await ConversationMessages.find({ customerId: customer._id })).toHaveLength(0);
  });

  test('Merge customers', async () => {
    const customerIds = ['123'];
    await internalNoteFactory({
      contentType: COC_CONTENT_TYPES.CUSTOMER,
      contentTypeId: customerIds[0],
    });
    await conversationFactory({
      customerId: customerIds[0],
    });
    await conversationMessageFactory({
      customerId: customerIds[0],
    });

    const doc = {
      firstName: 'Test first name',
      lastName: 'Test last name',
      email: 'Test email',
      phone: 'Test phone',
      facebookData: {
        id: '1231312',
      },
      twitterData: {
        name: '1234',
      },
      messengerData: {
        sessionCount: 6,
      },
    };

    const updatedCustomer = await Customers.mergeCustomers(customerIds, doc);

    expect(updatedCustomer.firstName).toBe(doc.firstName);
    expect(updatedCustomer.lastName).toBe(doc.lastName);
    expect(updatedCustomer.email).toBe(doc.email);
    expect(updatedCustomer.phone).toBe(doc.phone);
    expect(updatedCustomer.facebookData).toEqual(doc.facebookData);
    expect(await Conversations.find({ customerId: updatedCustomer._id })).not.toHaveLength(0);
    expect(await ConversationMessages.find({ customerId: updatedCustomer._id })).not.toHaveLength(
      0,
    );
    expect(
      await InternalNotes.find({
        contentType: COC_CONTENT_TYPES.CUSTOMER,
        contentTypeId: updatedCustomer._id,
      }),
    ).not.toHaveLength(0);
  });
});
