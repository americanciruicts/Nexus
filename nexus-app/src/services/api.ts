const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

class ApiService {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
    }
  }

  getToken() {
    if (typeof window !== 'undefined' && !this.token) {
      this.token = localStorage.getItem('token');
    }
    return this.token;
  }

  removeToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = this.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // Auth endpoints
  async login(username: string, password: string) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (response.access_token) {
      this.setToken(response.access_token);
    }

    return response;
  }

  async getCurrentUser() {
    return this.request('/auth/me');
  }

  // Traveler endpoints
  async getTravelers() {
    return this.request('/travelers/');
  }

  async getTraveler(id: number) {
    return this.request(`/travelers/${id}`);
  }

  async createTraveler(data: any) {
    return this.request('/travelers/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getTravelerTypes() {
    return this.request('/travelers/types/');
  }

  // Reports endpoints
  async getDashboardStats() {
    return this.request('/reports/dashboard-stats');
  }

  async getTravelerCompletionReport() {
    return this.request('/reports/traveler-completion');
  }

  async getLaborEfficiencyReport() {
    return this.request('/reports/labor-efficiency');
  }

  async getCoatingStatusReport() {
    return this.request('/reports/coating-status');
  }

  // Users endpoints
  async getUsers() {
    return this.request('/users/');
  }

  async createUser(data: any) {
    return this.request('/users/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const apiService = new ApiService();