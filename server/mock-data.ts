import type { Record_ } from "./types.js";

/** A small fake dataset the mock backend filters against. */
export const RECORDS: readonly Record_[] = [
  { id: 1, species: "oak", branches: 34, heightCm: 420, foliage: true, flowering: "april", plantedOn: "2018-03-12", notes: "Corner of the courtyard." },
  { id: 2, species: "oak", branches: 12, heightCm: 180, foliage: true, flowering: "may", plantedOn: "2022-05-02", notes: "" },
  { id: 3, species: "rose", branches: 8, heightCm: 60, foliage: true, flowering: "june", plantedOn: "2021-04-18", notes: "Needs trellis." },
  { id: 4, species: "rose", branches: 5, heightCm: 45, foliage: false, flowering: "july", plantedOn: "2023-06-01", notes: "" },
  { id: 5, species: "cactus", branches: 2, heightCm: 30, foliage: false, flowering: "", plantedOn: "2019-09-09", notes: "Barely watered, doing fine." },
  { id: 6, species: "fern", branches: 21, heightCm: 55, foliage: true, flowering: "", plantedOn: "2020-11-23", notes: "Shade only." },
  { id: 7, species: "bamboo", branches: 40, heightCm: 310, foliage: true, flowering: "", plantedOn: "2017-02-14", notes: "Contained — spreads fast." },
  { id: 8, species: "rose", branches: 22, heightCm: 90, foliage: true, flowering: "june", plantedOn: "2022-04-30", notes: "Prize winner two years running." },
];
