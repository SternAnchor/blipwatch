import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export interface RadarNetworkInterface {
  readonly address: string;
  readonly name: string;
}

export type NetworkInterfaceMap = Record<string, readonly NetworkInterfaceInfo[] | undefined>;

export const resolveRadarInterface = (
  configuredInterface: string,
  interfaces: NetworkInterfaceMap = networkInterfaces()
): RadarNetworkInterface => {
  if (configuredInterface !== "auto") {
    return {
      address: configuredInterface,
      name: "configured"
    };
  }

  return selectRadarInterface(interfaces) ?? {
    address: "0.0.0.0",
    name: "all-interfaces"
  };
};

export const selectRadarInterface = (interfaces: NetworkInterfaceMap): RadarNetworkInterface | undefined => {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => {
    return (entries ?? []).filter(isUsableIpv4Interface).map((entry) => ({
      address: entry.address,
      name,
      score: scoreInterface(name, entry.address)
    }));
  });

  return candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.name.localeCompare(right.name);
  })[0];
};

const isUsableIpv4Interface = (entry: NetworkInterfaceInfo): boolean => {
  return entry.family === "IPv4" && !entry.internal && entry.address !== "0.0.0.0";
};

const scoreInterface = (name: string, address: string): number => {
  let score = 0;

  if (isPrivateIpv4Address(address)) {
    score += 50;
  }

  if (address.startsWith("192.168.15.")) {
    score += 300;
  }

  if (/^(en|eth)\d+$/u.test(name)) {
    score += 100;
  }

  if (/^en[1-9]\d*$/u.test(name)) {
    score += 120;
  }

  if (/^(bridge|utun|awdl|llw|vmenet|vmnet|docker)/u.test(name)) {
    score -= 500;
  }

  return score;
};

const isPrivateIpv4Address = (address: string): boolean => {
  const [first = "", second = ""] = address.split(".");
  const firstOctet = Number.parseInt(first, 10);
  const secondOctet = Number.parseInt(second, 10);

  return (
    firstOctet === 10 ||
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168)
  );
};
