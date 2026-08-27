const earthRadiusKm = 6371.0088;

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function distanceKm(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(fromLatitude)) *
      Math.cos(radians(toLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

