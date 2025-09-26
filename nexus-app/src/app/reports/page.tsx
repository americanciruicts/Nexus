'use client';

import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CompletionReport } from '@/types';
import { apiService } from '@/services/api';
import { formatPercentage } from '@/utils/formatters';

export default function ReportsPage() {
  const [completionReport, setCompletionReport] = useState<CompletionReport | null>(null);
  const [laborReport, setLaborReport] = useState<any>(null);
  const [coatingReport, setCoatingReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const [completion, labor, coating] = await Promise.all([
        apiService.getTravelerCompletionReport(),
        apiService.getLaborEfficiencyReport(),
        apiService.getCoatingStatusReport()
      ]);

      setCompletionReport(completion);
      setLaborReport(labor);
      setCoatingReport(coating);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="p-6">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-64 bg-gray-200 rounded-lg"></div>
              ))}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Comprehensive insights into your manufacturing processes
          </p>
        </div>

        <div className="space-y-8">
          {/* Completion Report */}
          {completionReport && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">Total Travelers</p>
                    <p className="text-3xl font-bold text-blue-600">{completionReport.total_travelers}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">Completed</p>
                    <p className="text-3xl font-bold text-green-600">{completionReport.completed_travelers}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">In Progress</p>
                    <p className="text-3xl font-bold text-yellow-600">{completionReport.in_progress_travelers}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">Completion Rate</p>
                    <p className="text-3xl font-bold text-purple-600">{formatPercentage(completionReport.completion_rate)}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Completion by Type */}
          {completionReport && (
            <Card>
              <CardHeader>
                <CardTitle>Completion by Traveler Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {completionReport.by_type.map((type) => (
                    <div key={type.type} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-4 h-4 bg-blue-500 rounded"></div>
                        <span className="font-medium">{type.type}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">
                          {type.completed} of {type.total}
                        </div>
                        <div className="text-sm font-medium">
                          {formatPercentage(type.completion_rate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Labor Efficiency */}
          {laborReport && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Labor Efficiency Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Hours Logged</p>
                      <p className="text-2xl font-bold text-blue-600">
                        {laborReport.total_hours_logged.toFixed(1)} hrs
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Average Hours per Traveler</p>
                      <p className="text-2xl font-bold text-green-600">
                        {laborReport.average_hours_per_traveler.toFixed(1)} hrs
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Performers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {laborReport.efficiency_by_user.slice(0, 5).map((user: any, index: number) => (
                      <div key={user.username} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{user.name || user.username}</p>
                          <p className="text-sm text-gray-600">{user.travelers_worked} travelers</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{user.total_hours.toFixed(1)} hrs</p>
                          <p className="text-sm text-gray-600">
                            {user.avg_hours_per_traveler.toFixed(1)} hrs/traveler
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Export Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Export Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex space-x-4">
                <Button variant="secondary">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export to CSV
                </Button>
                <Button variant="secondary">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Export to PDF
                </Button>
                <Button variant="secondary">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Generate Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}