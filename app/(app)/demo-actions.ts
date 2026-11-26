"use server";

import { revalidatePath } from "next/cache";
import { resetDemo } from "@/lib/demo/db";
import { DEMO } from "@/lib/demo/mode";

/** Drops this visitor's demo edits, back to the original made-up data. */
export async function resetDemoAction() {
  if (!DEMO) return;
  await resetDemo();
  revalidatePath("/", "layout");
}
