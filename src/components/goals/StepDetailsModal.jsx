import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BookOpen,
  Link as LinkIcon,
  Video,
  FileText,
  Wrench,
  Globe,
  CheckCircle2,
  Lightbulb,
  X,
  Upload,
  Loader2,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";

const resourceTypeIcons = {
  video: Video,
  book: BookOpen,
  article: FileText,
  tool: Wrench,
  course: BookOpen,
  website: Globe,
  other: LinkIcon,
};

export default function StepDetailsModal({
  step,
  isOpen,
  onClose,
  onUpdate,
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(step?.notes || "");
  const [pictures, setPictures] = useState(step?.pictures || []);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveChanges = async () => {
    if (!step) return;
    setIsSaving(true);
    try {
      await base44.entities.GoalStep.update(step.id, { notes, pictures });
      toast({ title: "Step updated!" });
      onUpdate?.();
    } catch (err) {
      toast({ title: "Error saving changes", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      setPictures((prev) => [...prev, res.file_url]);
    } catch (err) {
      toast({ title: "Failed to upload image", variant: "destructive" });
    }
  };

  const removeImage = (url) => {
    setPictures((prev) => prev.filter((p) => p !== url));
  };

  if (!step) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{step.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Description */}
          {step.description && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Description
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed">
                {step.description}
              </p>
            </div>
          )}

          {/* Resources */}
          {step.step_resources && step.step_resources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-violet-600" />
                Resources
              </h3>
              <div className="space-y-3">
                {step.step_resources.map((resource, idx) => {
                  const Icon =
                    resourceTypeIcons[resource.type] || resourceTypeIcons.other;
                  return (
                    <div
                      key={idx}
                      className="p-3 border border-gray-200 rounded-lg hover:border-violet-300 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <Icon className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900">
                            {resource.title}
                          </p>
                          {resource.description && (
                            <p className="text-xs text-gray-600 mt-1">
                              {resource.description}
                            </p>
                          )}
                          {resource.specific_details && (
                            <p className="text-xs text-gray-500 mt-1 italic">
                              {resource.specific_details}
                            </p>
                          )}
                          {resource.url && (
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-violet-600 hover:text-violet-700 font-semibold mt-2 inline-block"
                            >
                              Click here →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Success Criteria */}
          {step.success_criteria && step.success_criteria.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Success Criteria
              </h3>
              <div className="space-y-2">
                {step.success_criteria.map((criterion, idx) => (
                  <div key={idx} className="flex gap-2 text-sm">
                    <Checkbox disabled defaultChecked={false} className="mt-1" />
                    <span className="text-gray-700">{criterion}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tips & Guidance */}
          {step.tips_and_guidance && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-600" />
                Tips & Guidance
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed bg-amber-50 border border-amber-100 rounded-lg p-3">
                {step.tips_and_guidance}
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-sm font-semibold text-gray-900 block mb-2">
              Personal Notes
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add your notes, reflections, or progress updates..."
              className="min-h-[100px] text-sm resize-none"
            />
          </div>

          {/* Photos */}
          <div>
            <label className="text-sm font-semibold text-gray-900 block mb-2">
              Photos
            </label>
            <div className="space-y-2">
              {pictures.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pictures.map((pic, idx) => (
                    <div key={idx} className="relative group">
                      <img
                        src={pic}
                        alt="Step"
                        className="w-20 h-20 rounded-lg object-cover border border-gray-200"
                      />
                      <button
                        onClick={() => removeImage(pic)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-violet-400 hover:bg-violet-50 cursor-pointer transition-all">
                <Upload className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">Add photo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadImage}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={handleSaveChanges}
              disabled={isSaving}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}