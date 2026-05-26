const STORAGE_KEY = 'gev-distance-unit';
const CHANGE_EVENT = 'gev-unit-change';

export type DistanceUnit = 'mi' | 'km';

export function getDistanceUnit(): DistanceUnit {
  return (localStorage.getItem(STORAGE_KEY) as DistanceUnit) ?? 'mi';
}

export function setDistanceUnit(unit: DistanceUnit): void {
  localStorage.setItem(STORAGE_KEY, unit);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: unit }));
}

export function onDistanceUnitChange(fn: (unit: DistanceUnit) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<DistanceUnit>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function kmToDisplay(km: number): string {
  const unit = getDistanceUnit();
  if (unit === 'mi') {
    return `${Math.round(km * 0.621371).toLocaleString()} mi`;
  }
  return `${km.toLocaleString()} km`;
}
