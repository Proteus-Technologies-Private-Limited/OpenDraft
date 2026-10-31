/** PageLayout's legacy fields keep their units; interchange conversions are explicit. */
export const inchesToPoints = (n: number): number => n * 72;
export const pointsToInches = (n: number): number => n / 72;
export const millimetersToInches = (n: number): number => n / 25.4;
export const osfToInches = (n: number): number => n / 254;
export const inchesToOsf = (n: number): number => Math.round(n * 254);
export const osfToPoints = (n: number): number =>
  inchesToPoints(osfToInches(n));
export const pointsToOsf = (n: number): number =>
  inchesToOsf(pointsToInches(n));
