import type { MessageAttachmentContext } from "./AttachmentPreview";
import { HtmlFileButton, isHtmlFile } from "./HtmlFilePreview";
import { SaveToDriveButton } from "./SaveToDriveButton";
import { TableFileButton } from "./TableFilePreview";

export function FilePreviewButton({ path, name, message }: { path: string; name: string; message: MessageAttachmentContext }) {
  const preview = isHtmlFile(name) || isHtmlFile(path) ? <HtmlFileButton path={path} name={name} message={message} /> : <TableFileButton path={path} name={name} message={message} />;
  return <>{preview}<SaveToDriveButton path={path} name={name} message={message} /></>;
}
