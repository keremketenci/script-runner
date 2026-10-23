import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shadcn/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shadcn/ui/dialog";
import { Input } from "@/shadcn/ui/input";

interface NameDialogProps {
  open: boolean;
  title: string;
  /** Optional line under the title, for example the original file name */
  description?: ReactNode;
  initialValue: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}

/** A small dialog with one text field, used for every "rename" in the app. */
export function NameDialog({
  open,
  title,
  description,
  initialValue,
  onCancel,
  onSave,
}: NameDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialValue);

  // Start from the current name each time the dialog opens
  useEffect(() => {
    if (open) setDraft(initialValue);
  }, [open, initialValue]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave(draft);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Input
            autoFocus
            aria-label={title}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
