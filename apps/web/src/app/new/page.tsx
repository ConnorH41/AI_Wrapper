import { createProjectAction } from "../actions";
import { FileField } from "@/components/file-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function NewProjectPage() {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>New project</CardTitle>
        <CardDescription>
          A prompt is enough to start. Add a product photo if you have one — the
          real packshot is composited in. Without it, stills are title cards
          from the project name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createProjectAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Steel bottle" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              name="prompt"
              required
              placeholder="A 15-second ad for a stainless steel water bottle. Confident, clean, no gimmicks."
            />
          </div>
          <FileField
            id="packshot"
            name="packshot"
            label="Product photo (optional)"
            hint="Used as the real packshot in the frame. Skip this if you only have a prompt."
          />
          <FileField
            id="references"
            name="references"
            label="Person references (optional)"
            multiple
          />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="consent" className="mt-1" />
            <span>
              I have the right to use any person in these reference photos and
              they have consented to appearing in generated media.
            </span>
          </label>
          <Button type="submit">Create project</Button>
        </form>
      </CardContent>
    </Card>
  );
}
