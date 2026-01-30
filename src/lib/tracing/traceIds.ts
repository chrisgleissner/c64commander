let eventCounter = 0;
let correlationCounter = 0;

export const nextTraceEventId = () => {
  eventCounter += 1;
  return eventCounter;
};

export const nextCorrelationId = () => {
  correlationCounter += 1;
  return correlationCounter;
};

export const resetTraceIds = (eventStart = 1, correlationStart = 1) => {
  eventCounter = Math.max(0, Math.floor(eventStart) - 1);
  correlationCounter = Math.max(0, Math.floor(correlationStart) - 1);
};

export const getTraceIdSnapshot = () => ({
  nextEventId: eventCounter + 1,
  nextCorrelationId: correlationCounter + 1,
});