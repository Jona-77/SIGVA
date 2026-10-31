export function arrivesNextDay(departure: string, arrival: string) {
  return arrival.slice(0, 10) > departure.slice(0, 10);
}