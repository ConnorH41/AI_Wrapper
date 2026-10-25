"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

export function FileField({
  id,
  name,
  label,
  hint,
  multiple,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  multiple?: boolean;
}) {
  const [files, setFiles] = useState<string[]>([]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      <input
        id={id}
        name={name}
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={(event) => {
          const list = event.target.files;
          setFiles(list ? Array.from(list).map((file) => file.name) : []);
        }}
        className="block w-full cursor-pointer text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
      />
      {files.length > 0 ? (
        <p className="text-sm text-muted-foreground">{files.join(", ")}</p>
      ) : null}
    </div>
  );
}
