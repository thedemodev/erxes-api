import * as _ from 'underscore';
import { Segments } from '../../../db/models';
import { companySchema } from '../../../db/models/definitions/companies';
import { customerSchema } from '../../../db/models/definitions/customers';
import { ICondition, ISegment } from '../../../db/models/definitions/segments';
import { fetchElk } from '../../../elasticsearch';

export const fetchBySegments = async (segment: ISegment, action: 'search' | 'count' = 'search'): Promise<any> => {
  if (!segment || !segment.conditions) {
    return [];
  }

  const { contentType } = segment;
  const index = contentType === 'company' ? 'companies' : 'customers';
  const idField = contentType === 'company' ? 'companyId' : 'customerId';
  const schema = contentType === 'company' ? companySchema : customerSchema;
  const typesMap: { [key: string]: any } = {};

  schema.eachPath(name => {
    const path = schema.paths[name];
    typesMap[name] = path.options.esType;
  });

  const propertyPositive: any[] = [];
  const propertyNegative: any[] = [];

  if (contentType !== 'company') {
    propertyNegative.push({
      term: {
        status: 'Deleted',
      },
    });
  }

  const eventPositive = [];
  const eventNegative = [];

  await generateQueryBySegment({ segment, typesMap, propertyPositive, propertyNegative, eventNegative, eventPositive });

  let idsByEvents = [];

  if (eventPositive.length > 0 || eventNegative.length > 0) {
    const eventsResponse = await fetchElk('search', 'events', {
      _source: idField,
      size: 10000,
      query: {
        bool: {
          must: eventPositive,
          must_not: eventNegative,
        },
      },
    });

    idsByEvents = eventsResponse.hits.hits.map(hit => hit._source[idField]);

    propertyPositive.push({
      terms: {
        _id: idsByEvents,
      },
    });
  }

  if (action === 'count') {
    return {
      positiveList: propertyPositive,
      negativeList: propertyNegative,
    };
  }

  const response = await fetchElk('search', index, {
    _source: false,
    size: 10000,
    query: {
      bool: {
        must: propertyPositive,
        must_not: propertyNegative,
      },
    },
  });

  const idsByContentType = response.hits.hits.map(hit => hit._id);

  let ids = idsByContentType.length ? idsByContentType : idsByEvents;

  if (idsByContentType.length > 0 && idsByEvents.length > 0) {
    ids = _.intersection(idsByContentType, idsByEvents);
  }

  return ids;
};

const generateQueryBySegment = async (args: {
  propertyPositive;
  propertyNegative;
  eventPositive;
  eventNegative;
  segment: ISegment;
  typesMap: { [key: string]: any };
}) => {
  const { segment, typesMap, propertyNegative, propertyPositive, eventNegative, eventPositive } = args;

  // Fetching parent segment
  const embeddedParentSegment = await Segments.findOne({ _id: segment.subOf });
  const parentSegment = embeddedParentSegment;

  if (parentSegment) {
    await generateQueryBySegment({ ...args, segment: parentSegment });
  }

  const propertyConditions: ICondition[] = [];
  const eventConditions: ICondition[] = [];

  for (const condition of segment.conditions) {
    if (condition.type === 'property') {
      propertyConditions.push(condition);
    }

    if (condition.type === 'event') {
      eventConditions.push(condition);
    }
  }

  for (const condition of propertyConditions) {
    const field = condition.propertyName || '';

    elkConvertConditionToQuery({
      field,
      type: typesMap[field],
      operator: condition.propertyOperator || '',
      value: condition.propertyValue || '',
      positive: propertyPositive,
      negative: propertyNegative,
    });
  }

  for (const condition of eventConditions) {
    const { eventOccurence, eventName, eventOccurenceValue, eventAttributeFilters = [] } = condition;

    if (!eventOccurence || !eventOccurenceValue) {
      continue;
    }

    eventPositive.push({
      term: {
        name: eventName,
      },
    });

    if (eventOccurence === 'exactly') {
      eventPositive.push({
        term: {
          count: eventOccurenceValue,
        },
      });
    }

    if (eventOccurence === 'atleast') {
      eventPositive.push({
        range: {
          count: {
            gte: eventOccurenceValue,
          },
        },
      });
    }

    if (eventOccurence === 'atmost') {
      eventPositive.push({
        range: {
          count: {
            lte: eventOccurenceValue,
          },
        },
      });
    }

    for (const filter of eventAttributeFilters) {
      elkConvertConditionToQuery({
        field: `attributes.${filter.name}`,
        operator: filter.operator,
        value: filter.value,
        positive: eventPositive,
        negative: eventNegative,
      });
    }
  }
};

function elkConvertConditionToQuery(args: {
  field: string;
  type?: any;
  operator: string;
  value: string;
  positive;
  negative;
}) {
  const { field, type, operator, value, positive, negative } = args;

  const fixedValue = value.toLocaleLowerCase();

  // equal
  if (operator === 'e') {
    if (['keyword', 'email'].includes(type)) {
      positive.push({
        term: { [field]: value },
      });
    } else {
      positive.push({
        term: { [`${field}.keyword`]: value },
      });
    }
  }

  // does not equal
  if (operator === 'dne') {
    if (['keyword', 'email'].includes(type)) {
      negative.push({
        term: { [field]: value },
      });
    } else {
      negative.push({
        term: { [`${field}.keyword`]: value },
      });
    }
  }

  // contains
  if (operator === 'c') {
    positive.push({
      wildcard: {
        [field]: `*${fixedValue}*`,
      },
    });
  }

  // does not contains
  if (operator === 'dnc') {
    negative.push({
      wildcard: {
        [field]: `*${fixedValue}*`,
      },
    });
  }

  // greater than equal
  if (operator === 'igt') {
    positive.push({
      range: {
        [field]: {
          gte: fixedValue,
        },
      },
    });
  }

  // less then equal
  if (operator === 'ilt') {
    positive.push({
      range: {
        [field]: {
          lte: fixedValue,
        },
      },
    });
  }

  // is true
  if (operator === 'it') {
    positive.push({
      term: {
        [field]: true,
      },
    });
  }

  // is true
  if (operator === 'if') {
    positive.push({
      term: {
        [field]: false,
      },
    });
  }

  // is set
  if (operator === 'is') {
    positive.push({
      exists: {
        field,
      },
    });
  }

  // is not set
  if (operator === 'ins') {
    negative.push({
      exists: {
        field,
      },
    });
  }

  if (['woam', 'wobm', 'woad', 'wobd'].includes(operator)) {
    let gte = '';
    let lte = '';

    // will occur after on following n-th minute
    if (operator === 'woam') {
      gte = `now-${fixedValue}m/m`;
      lte = `now-${fixedValue}m/m`;
    }

    // will occur before on following n-th minute
    if (operator === 'wobm') {
      gte = `now+${fixedValue}m/m`;
      lte = `now+${fixedValue}m/m`;
    }

    // will occur after on following n-th day
    if (operator === 'woad') {
      gte = `now-${fixedValue}d/d`;
      lte = `now-${fixedValue}d/d`;
    }

    // will occur before on following n-th day
    if (operator === 'wobd') {
      gte = `now+${fixedValue}d/d`;
      lte = `now+${fixedValue}d/d`;
    }

    positive.push({ range: { [field]: { gte, lte } } });
  }

  // date relative less than
  if (operator === 'drlt') {
    positive.push({ range: { [field]: { lte: fixedValue } } });
  }

  // date relative greater than
  if (operator === 'drgt') {
    positive.push({ range: { [field]: { gte: fixedValue } } });
  }
}
