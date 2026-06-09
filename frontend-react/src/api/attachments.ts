import { apiClient } from './client'

export type DocBase = 'invoices' | 'partial-payments'

export interface InvoiceAttachment {
  ID:                    number
  TENANT_ID:             number
  INVOICE_ID:            number | null
  PP_ID:                 number | null
  ASSET_ID:              number
  DESCRIPTION:           string | null
  ATTACHMENT_TYPE_CODE:  string
  DOCUMENT_REFERENCE:    string | null
  POSITION:              number
  CREATED_AT:            string
  ASSET?: {
    ID:        number
    FILE_NAME: string
    MIME_TYPE: string
    FILE_SIZE: number
  }
}

export const fetchAttachments = (base: DocBase, docId: number) =>
  apiClient.get<{ data: InvoiceAttachment[] }>(`/${base}/${docId}/attachments`)

export const addAttachment = (
  base: DocBase, docId: number,
  body: { asset_id: number; description?: string; attachment_type_code?: string; document_reference?: string }
) =>
  apiClient.post<{ data: InvoiceAttachment }>(`/${base}/${docId}/attachments`, body)

export const patchAttachment = (
  base: DocBase, docId: number, attId: number,
  body: { description?: string; attachment_type_code?: string; document_reference?: string; position?: number }
) =>
  apiClient.patch<{ data: InvoiceAttachment }>(`/${base}/${docId}/attachments/${attId}`, body)

export const deleteAttachment = (base: DocBase, docId: number, attId: number) =>
  apiClient.delete<{ ok: boolean }>(`/${base}/${docId}/attachments/${attId}`)
