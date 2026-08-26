import { getCurrentUser } from "@/lib/currentUser";
import { apiError } from "@/lib/errors";
import { getForecastCalibrationSummary } from "@/lib/validation/shadowForecastStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const summary = await getForecastCalibrationSummary(user.id);
    return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
