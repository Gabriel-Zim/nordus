import type { DoctorService } from "../doctor/service.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Admin only: request-auth leaves every route off its client list admin-scoped. */
export function createDoctorRoutes(deps: { doctor: Pick<DoctorService, "report"> }): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method !== "GET" || path !== "/api/doctor") return PASS;
    const refresh = url.searchParams.get("refresh");
    res.setHeader("cache-control", "no-store");
    return json(res, 200, await deps.doctor.report({ refresh: refresh === "1" || refresh === "true" }));
  };
}
