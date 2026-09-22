export type Formations = {
  count: number;
  map: [number, number, number][];
  heart: [number, number, number][];
  mapDepth: number[];
  heartDepth: number[];
};

export async function loadFormations(): Promise<Formations> {
  const res = await fetch("/data/formations.json");
  if (!res.ok) throw new Error("Failed to load particle formations");
  return res.json();
}
