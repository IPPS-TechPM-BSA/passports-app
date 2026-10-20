import { AUTH_STORAGE_KEY } from './authStorage'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = /* we'll inject this later */ null
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.location.href = '/dashboard/login'
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json()
}

export const api = {
  checkin(data: Record<string, unknown>) {
    return request('/checkin', { method: 'POST', body: JSON.stringify(data) })
  },
  getVisitors(location: string, params?: { date?: string; search?: string }) {
    const q = new URLSearchParams({ location, ...params })
    return request(`/visitors?${q}`)
  },
  updateVisitorStatus(id: string, status: string) {
    return request(`/visitors/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },
  updateVisitorNotes(id: string, notes: string) {
    return request(`/visitors/${id}/notes`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    })
  },
  exportVisitors(location: string) {
    return fetch(`${API_BASE}/visitors/export?location=${location}`).then(r => r.blob())
  },
  getQuestions() {
    return request<FormQuestion[]>('/questions')
  },
  getStats(location: string) {
    return request(`/stats?location=${location}`)
  },
  login(password: string) {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
  },
  getSurveyQuestions() {
    return request<SurveyQuestion[]>('/survey/questions')
  },
  updateSurveyQuestions(questions: SurveyQuestionInput[], token: string) {
    return request<SurveyQuestion[]>('/survey/questions', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ questions }),
    })
  },
  submitSurveyResponse(data: SurveySubmission) {
    return request('/survey/responses', { method: 'POST', body: JSON.stringify(data) })
  },
  deleteSurveyResponses(ids: string[], token: string) {
    return request<{ ok: boolean; deleted: number }>('/survey/responses/bulk-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids }),
    })
  },
  getSurveyResponses(location: string, token: string) {
    return request<SurveyResponseRecord[]>(`/survey/responses?location=${location}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  },
}

export interface FormQuestion {
  key: string
  title: string
  description: string
  /** Must be answered Yes or No before a passport visitor can finish. */
  required: boolean
}

export type SurveyQuestionType = 'checkbox' | 'text' | 'rating' | 'multiselect'
/** A list of the chosen options for a "select all that apply" question. */
export type SurveyAnswerValue = boolean | number | string | string[] | null

export interface SurveyQuestion {
  id: string
  type: SurveyQuestionType
  label: string
  required: boolean
  /** The possible selections; empty unless the type is 'multiselect'. */
  options: string[]
}

export interface SurveyQuestionInput {
  /** A saved question's id, so it (and its answers) is kept; omitted for a new question. */
  id?: string
  question_type: SurveyQuestionType
  label: string
  required: boolean
  options: string[]
}

export interface SurveySubmission {
  location_id: string
  name: string
  email: string
  answers: { question_id: string; value: SurveyAnswerValue }[]
}

export interface SurveyResponseRecord {
  id: string
  location_id: string
  name: string
  email: string
  answers: {
    question_id: string
    type: SurveyQuestionType
    label: string
    value: SurveyAnswerValue
 }[]
  submitted_at: string
}
