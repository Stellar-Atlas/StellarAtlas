import { Network } from "shared";
import { err, ok, Result } from "neverthrow";
import { type NetworkRepository } from "@/repositories/NetworkRepository";

//repository to connect to stellarobserver api to fetch networks
export class StellarobserverNetworkV1Repository implements NetworkRepository {
  constructor(protected apiBaseUrl: string) {}

  async find(at?: Date): Promise<Result<Network, Error>> {
    try {
      const params: Record<string, unknown> = {};
      if (at) {
        params["at"] = at.toISOString();
      }
      const url = new URL(this.apiBaseUrl + "/v1");
      Object.keys(params).forEach((key) =>
        url.searchParams.append(key, params[key] as string),
      );
      const response = await fetch(url.toString());
      if (!response.ok) return err(new Error("Network request failed"));
      const data = await response.json();
      if (!data) return err(new Error("No data property in result"));

      return ok(Network.fromJSON(data));
    } catch (error) {
      if (error instanceof Error) return err(error);
      return err(new Error("Error fetching Network"));
    }
  }
}
