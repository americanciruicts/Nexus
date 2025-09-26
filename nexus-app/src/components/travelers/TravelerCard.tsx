'use client';

import Link from 'next/link';
import { Traveler } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';
import { formatDate } from '@/utils/formatters';

interface TravelerCardProps {
  traveler: Traveler;
}

export function TravelerCard({ traveler }: TravelerCardProps) {
  const statusColors = {
    created: 'bg-gray-100 text-gray-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  return (
    <Card className="hover:shadow-lg transition-shadow duration-200">
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: traveler.traveler_type.color_code }}
            />
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                <Link href={`/travelers/${traveler.id}`} className="hover:text-blue-600">
                  {traveler.traveler_number}
                </Link>
              </h3>
              <p className="text-sm text-gray-500">
                {traveler.traveler_type.type_name} • {traveler.purchase_order.customer_name}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              statusColors[traveler.status as keyof typeof statusColors]
            }`}
          >
            {traveler.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">PO Number</p>
            <p className="text-sm text-gray-900">{traveler.purchase_order.po_number}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Job Number</p>
            <p className="text-sm text-gray-900">{traveler.job_number || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Revision</p>
            <p className="text-sm text-gray-900">Rev {traveler.revision}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Created</p>
            <p className="text-sm text-gray-900">{formatDate(traveler.created_at)}</p>
          </div>
        </div>

        {traveler.barcode && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2">Barcode</p>
            <img
              src={traveler.barcode}
              alt={`Barcode for ${traveler.traveler_number}`}
              className="h-12"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}