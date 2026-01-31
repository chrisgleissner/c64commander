let eventCounter = -1;
let correlationCounter = -1;

const formatTraceId = (prefix: 'EVT' | 'COR', value: number) => `${prefix}-${String(value).padStart(4, '0')}`;

export const nextTraceEventId = () => {
  eventCounter += 1;
  return formatTraceId('EVT', eventCounter);
};

export const nextCorrelationId = () => {
  correlationCounter += 1;
  return formatTraceId('COR', correlationCounter);
};

export const resetTraceIds = (eventStart = 0, correlationStart = 0) => {
  const eventBase = Math.max(0, Math.floor(eventStart));
  const correlationBase = Math.max(0, Math.floor(correlationStart));
  eventCounter = eventBase - 1;
  correlationCounter = correlationBase - 1;
};

export const getTraceIdSnapshot = () => ({
  nextEventId: formatTraceId('EVT', eventCounter + 1),
  nextCorrelationId: formatTraceId('COR', correlationCounter + 1),
});