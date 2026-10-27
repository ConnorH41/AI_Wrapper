import { notFound } from "next/navigation";

export function requireLegacyDevelopment(): void {
  if (process.env.NODE_ENV === "production") notFound();
}
