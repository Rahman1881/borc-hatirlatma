"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Template {
  id: number;
  name: string;
  body: string;
  created_at: string;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchTemplates = () => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then(setTemplates);
  };

  useEffect(() => {
    fetchTemplates();
    // Fetch available Excel columns from settings
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.excel_columns) {
          try {
            setExcelColumns(JSON.parse(data.excel_columns));
          } catch { /* ignore */ }
        }
      });
  }, []);

  const handleSave = async () => {
    if (!name || !body) {
      toast.error("İsim ve mesaj içeriği gerekli");
      return;
    }

    const method = editingId ? "PUT" : "POST";
    const payload = editingId ? { id: editingId, name, body } : { name, body };

    const res = await fetch("/api/templates", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.error) {
      toast.error(data.error);
    } else {
      toast.success(editingId ? "Şablon güncellendi" : "Şablon oluşturuldu");
      setName("");
      setBody("");
      setEditingId(null);
      fetchTemplates();
    }
  };

  const handleEdit = (t: Template) => {
    setEditingId(t.id);
    setName(t.name);
    setBody(t.body);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Bu şablonu silmek istediğinize emin misiniz?")) return;
    await fetch("/api/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Şablon silindi");
    fetchTemplates();
  };

  const handleCancel = () => {
    setEditingId(null);
    setName("");
    setBody("");
  };

  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setBody((prev) => prev + `{${varName}}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = `{${varName}}`;
    const newBody = body.substring(0, start) + text + body.substring(end);
    setBody(newBody);
    // Restore cursor position after the inserted variable
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mesaj Şablonları</h2>
        <p className="text-muted-foreground">
          WhatsApp mesajlarınız için şablonlar oluşturun ve yönetin
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? "Şablonu Düzenle" : "Yeni Şablon"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Şablon Adı</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Borç Hatırlatma"
              />
            </div>
            <div className="space-y-2">
              <Label>Mesaj İçeriği</Label>
              <Textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Sayın {isim}, {tutar} TL borcunuz..."
                rows={5}
              />
            </div>
            <div className="bg-muted rounded-lg p-3 space-y-3">
              <div>
                <p className="text-xs font-medium mb-2">
                  Temel Değişkenler:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "isim", desc: "Müşteri adı" },
                    { label: "tutar", desc: "Toplam borç" },
                    { label: "vadeli_borc", desc: "Vadesi geçmiş borç" },
                  ].map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => insertVariable(v.label)}
                      className="inline-flex items-center px-2.5 py-1 rounded-md border bg-background text-xs font-mono hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                      title={v.desc}
                    >
                      {`{${v.label}}`}
                    </button>
                  ))}
                </div>
              </div>
              {excelColumns.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">
                    Excel Sütunları (tıklayarak ekleyin):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {excelColumns.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => insertVariable(col)}
                        className="inline-flex items-center px-2.5 py-1 rounded-md border bg-background text-xs hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                      >
                        {`{${col}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {excelColumns.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Excel yükledikten sonra sütun adları burada seçilebilir olacak.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave}>
                {editingId ? "Güncelle" : "Oluştur"}
              </Button>
              {editingId && (
                <Button variant="outline" onClick={handleCancel}>
                  İptal
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <div className="space-y-4">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(t)}
                    >
                      Düzenle
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(t.id)}
                      className="text-destructive"
                    >
                      Sil
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap">{t.body}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t.created_at}
                </p>
              </CardContent>
            </Card>
          ))}

          {templates.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">
                  Henüz şablon oluşturulmadı
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
