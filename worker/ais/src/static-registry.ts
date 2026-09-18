import { isTankerType } from './state-machine.js';

/** In-memory MMSI -> AIS ship-type map, built from ShipStaticData messages. Only tankers (80-89) are retained. */
export class ShipTypeRegistry {
  private readonly tankerTypes = new Map<number, number>();

  observe(mmsi: number, shipType: number): void {
    if (isTankerType(shipType)) this.tankerTypes.set(mmsi, shipType);
    else this.tankerTypes.delete(mmsi); // a reused/reassigned MMSI stops being tracked as a tanker
  }

  get(mmsi: number): number | undefined {
    return this.tankerTypes.get(mmsi);
  }

  get size(): number {
    return this.tankerTypes.size;
  }
}
