// Yakıt Ofisi `fuelType` değerlerinin okunur adları (API belgesindeki FuelType listesinden;
// değer sayı ya da adıyla gelebilir). Hem Satışlar ekranı hem RotaNet gönderimi kullanır.
export const YO_FUEL_NAMES: Record<string, string> = {
  "0": "Kurşunsuz 95",
  "1": "ProDiesel",
  "2": "EuroDiesel",
  "31": "AdBlue",
  "37": "HGS",
  "45": "HGS etiket",
  Benzine95: "Kurşunsuz 95",
  ProDiesel: "ProDiesel",
  EuroDiesel: "EuroDiesel",
  PoAdBlue: "AdBlue",
  Toll: "HGS",
  TollTag: "HGS etiket",
};

// HGS geçişi ve HGS etiket satışı (yakıt değil).
export const YO_TOLL_FUEL_TYPES = new Set(["37", "45", "Toll", "TollTag"]);
