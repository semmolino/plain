import { apiClient } from './client'

export interface Employee {
  ID:               number
  SHORT_NAME:       string
  TITLE:            string | null
  FIRST_NAME:       string
  LAST_NAME:        string
  MAIL:             string | null
  MOBILE:           string | null
  PERSONNEL_NUMBER: string | null
  GENDER_ID:        number | null
  GENDER:           string
  NAME:             string
}

export interface EmpGender { ID: number; GENDER: string }

export interface CreateEmployeePayload {
  short_name:       string
  title?:           string
  first_name:       string
  last_name:        string
  password?:        string
  email?:           string
  mobile?:          string
  personnel_number?: string
  gender_id:        string | number
}

export interface UpdateEmployeePayload {
  short_name:       string
  title?:           string
  first_name:       string
  last_name:        string
  mail?:            string
  mobile?:          string
  personnel_number?: string
  gender_id:        number
}

export const fetchEmployeeGenders = () =>
  apiClient.get<{ data: EmpGender[] }>('/mitarbeiter/genders')

export const fetchEmployeeList = () =>
  apiClient.get<{ data: Employee[] }>('/mitarbeiter/list?limit=2000')

export const createEmployee = (body: CreateEmployeePayload) =>
  apiClient.post<{ data: Employee[] }>('/mitarbeiter', body)

export const updateEmployee = (id: number, body: UpdateEmployeePayload) =>
  apiClient.patch<{ data: Employee }>(`/mitarbeiter/${id}`, body)
