"use server";

import path from "node:path";
import {
  addAsset,
  approveStill,
  assertCanCreateProject,
  createProject,
  enqueueChainA,
  enqueueChainB,
  getProject,
  setStatus,
  storage,
} from "@aiw/core";
import { redirect } from "next/navigation";

function extOf(file: File): string {
  const fromName = path.extname(file.name);
  if (fromName) return fromName;
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  return ".jpg";
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim() || "Untitled";
  const prompt = String(formData.get("prompt") ?? "").trim();
  const packshot = formData.get("packshot");
  const references = formData.getAll("references").filter((v): v is File => v instanceof File && v.size > 0);
  const consent = formData.get("consent") === "on";

  if (!prompt) throw new Error("A prompt is required");
  const hasPackshot = packshot instanceof File && packshot.size > 0;
  if (references.length > 0 && !consent) {
    throw new Error("Consent is required when uploading a person reference");
  }

  await assertCanCreateProject();

  const project = await createProject({
    title,
    prompt,
    consentAttested: consent,
  });

  if (hasPackshot) {
    const productKey = `${project.id}/product${extOf(packshot)}`;
    await storage.put(
      productKey,
      Buffer.from(await packshot.arrayBuffer()),
      packshot.type || "image/jpeg",
    );
    await addAsset({
      projectId: project.id,
      kind: "product",
      storageKey: productKey,
      mime: packshot.type || "image/jpeg",
    });
  }

  for (const [index, file] of references.entries()) {
    const key = `${project.id}/reference-${index}${extOf(file)}`;
    await storage.put(key, Buffer.from(await file.arrayBuffer()), file.type || "image/jpeg");
    await addAsset({
      projectId: project.id,
      kind: "reference",
      storageKey: key,
      mime: file.type || "image/jpeg",
    });
  }

  await enqueueChainA(project.id);
  redirect(`/projects/${project.id}`);
}

export async function approveAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const stillId = String(formData.get("stillId") ?? "");
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (project.status !== "awaiting_approval") {
    throw new Error("This project is not waiting for approval");
  }
  if (!stillId) throw new Error("Pick a still to approve");

  await approveStill(projectId, stillId);
  await setStatus(projectId, "rendering");
  await enqueueChainB(projectId);
  redirect(`/projects/${projectId}`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (project.status !== "awaiting_approval") {
    throw new Error("This project is not waiting for approval");
  }

  await setStatus(projectId, "scripting");
  await enqueueChainA(projectId);
  redirect(`/projects/${projectId}`);
}
