export interface AuthUser {
  employee_id:  number
  tenant_id:    number
  email:        string
  short_name:   string
  company_name: string | null
}

export interface AuthState {
  token:       string | null
  employeeId:  number | null
  tenantId:    number | null
  shortName:   string | null
  email:       string | null
  companyName: string | null
  isLoading:   boolean
}
