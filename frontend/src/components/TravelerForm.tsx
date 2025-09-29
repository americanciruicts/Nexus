'use client';

import { useState, useEffect } from 'react';
import { TravelerType, ProcessStep, SubStep } from '@/types';
import {
  PrinterIcon,
  QrCodeIcon,
} from '@heroicons/react/24/outline';

interface TravelerFormProps {
  mode?: 'create' | 'edit' | 'view';
  travelerId?: number;
}

export default function TravelerForm({ mode = 'create', travelerId }: TravelerFormProps) {
  const [formData, setFormData] = useState({
    jobNumber: '8414L',
    workOrderNumber: '8414L-ASSY',
    travelerType: 'ASSY' as TravelerType,
    partNumber: 'METSHIFT',
    partDescription: 'METSHIFT Assembly',
    revision: 'V0.2',
    quantity: 250,
    customerCode: 'ACME',
    customerName: 'ACME Corporation',
    workCenter: 'ASSEMBLY',
    priority: 'NORMAL' as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
    processSteps: [] as ProcessStep[],
    manualSteps: [],
    notes: '',
    // Additional fields from Image.jpg
    poNumber: 'METMXP-2',
    operation: '84',
    pageNumber: '1',
    totalPages: '1',
    partRev: 'V0.2 01/24/24',
    drawingNumber: '88424',
    specs: 'NEW REV 03/662-04/722',
    routingNotes: 'From Stock',
    comments: 'For Antenna Routing & placement See BOM - 04/24'
  });

  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);

  useEffect(() => {
    if (formData.travelerType) {
      loadManufacturingSteps(formData.travelerType);
    }
  }, [formData.travelerType]);

  interface ManufacturingStep {
    id: string;
    stepNumber: number;
    operation: string;
    workCenter: string;
    instructions: string;
    estimatedTime: number;
    isRequired: boolean;
    subSteps: SubStep[];
  }

  const loadManufacturingSteps = async (type: TravelerType) => {
    // Mock data matching the image format
    const stepsData: Record<TravelerType, ManufacturingStep[]> = {
      PCB: [
        {
          id: '1',
          stepNumber: 1,
          operation: 'ENGINEER',
          workCenter: 'ENGINEERING',
          instructions: 'Review PCB specifications and engineering requirements',
          estimatedTime: 30,
          isRequired: true,
          subSteps: []
        },
      ],
      ASSY: [
        {
          id: '1',
          stepNumber: 1,
          operation: 'ENGINEER',
          workCenter: 'ENGINEERING',
          instructions: 'Review assembly specifications',
          estimatedTime: 30,
          isRequired: true,
          subSteps: []
        },
        {
          id: '2',
          stepNumber: 2,
          operation: 'MAKE BOM',
          workCenter: 'ENGINEERING',
          instructions: 'Create and verify Bill of Materials',
          estimatedTime: 45,
          isRequired: true,
          subSteps: []
        },
        {
          id: '3',
          stepNumber: 6,
          operation: 'PREPARE',
          workCenter: 'ASSEMBLY',
          instructions: 'Prepare components and workspace',
          estimatedTime: 60,
          isRequired: true,
          subSteps: []
        },
        {
          id: '4',
          stepNumber: 10,
          operation: 'AUTO INSERTION',
          workCenter: 'ASSEMBLY',
          instructions: 'Automated component insertion',
          estimatedTime: 120,
          isRequired: true,
          subSteps: []
        },
        {
          id: '5',
          stepNumber: 12,
          operation: 'WASH',
          workCenter: 'CLEANING',
          instructions: 'Wash PCB assembly',
          estimatedTime: 25,
          isRequired: true,
          subSteps: []
        },
        {
          id: '6',
          stepNumber: 16,
          operation: 'MANUAL INNER',
          workCenter: 'ASSEMBLY',
          instructions: 'Manual inner component placement - 1.5 hrs',
          estimatedTime: 90,
          isRequired: true,
          subSteps: []
        },
        {
          id: '7',
          stepNumber: 30,
          operation: 'WAVE SOLDER',
          workCenter: 'SOLDERING',
          instructions: 'Wave solder - 1.5 hrs',
          estimatedTime: 90,
          isRequired: true,
          subSteps: []
        },
        {
          id: '8',
          stepNumber: 32,
          operation: 'WASH',
          workCenter: 'CLEANING',
          instructions: 'Post-solder cleaning',
          estimatedTime: 25,
          isRequired: true,
          subSteps: []
        },
        {
          id: '9',
          stepNumber: 34,
          operation: 'TRIM',
          workCenter: 'FINISHING',
          instructions: 'PCB Trim/Cut thru J3E of PCB 5k 25¢',
          estimatedTime: 15,
          isRequired: true,
          subSteps: []
        },
        {
          id: '10',
          stepNumber: 36,
          operation: 'VISUAL INSPECTION',
          workCenter: 'QC',
          instructions: 'Visual inspection and quality check',
          estimatedTime: 30,
          isRequired: true,
          subSteps: []
        },
        {
          id: '11',
          stepNumber: 40,
          operation: 'E-TEST',
          workCenter: 'TESTING',
          instructions: 'Electrical testing',
          estimatedTime: 45,
          isRequired: true,
          subSteps: []
        },
        {
          id: '12',
          stepNumber: 42,
          operation: 'MANUAL OUTER',
          workCenter: 'ASSEMBLY',
          instructions: 'Conformal Coating STRIP MASKIT 250',
          estimatedTime: 60,
          isRequired: true,
          subSteps: []
        },
        {
          id: '13',
          stepNumber: 44,
          operation: 'SUB-ASSY',
          workCenter: 'ASSEMBLY',
          instructions: 'Cable 6"bottom Routing/test/kit',
          estimatedTime: 30,
          isRequired: true,
          subSteps: []
        },
        {
          id: '14',
          stepNumber: 46,
          operation: 'FINAL INSPEC',
          workCenter: 'QC',
          instructions: 'Final quality inspection',
          estimatedTime: 20,
          isRequired: true,
          subSteps: []
        },
        {
          id: '15',
          stepNumber: 48,
          operation: 'LABELING',
          workCenter: 'PACKAGING',
          instructions: 'Apply labels - Part Levels Only 25¢',
          estimatedTime: 10,
          isRequired: true,
          subSteps: []
        },
        {
          id: '16',
          stepNumber: 50,
          operation: 'PACKAGING',
          workCenter: 'PACKAGING',
          instructions: 'Package for shipment',
          estimatedTime: 15,
          isRequired: true,
          subSteps: []
        },
        {
          id: '17',
          stepNumber: 50,
          operation: 'SHIPPING',
          workCenter: 'SHIPPING',
          instructions: 'Prepare for shipping',
          estimatedTime: 10,
          isRequired: true,
          subSteps: []
        }
      ],
      CABLE: [],
      CABLE_ASSY: [],
      MECHANICAL: [],
      TEST: []
    };

    setProcessSteps(stepsData[type] || []);
  };

  const handleAutoPopulate = async () => {
    // Mock auto-population logic
    setFormData(prev => ({
      ...prev,
      customerName: 'ACME Corporation',
      partDescription: 'METSHIFT Assembly Rev V0.2',
      workCenter: 'ASSEMBLY'
    }));
  };

  const generateBarcode = () => {
    // Mock barcode generation
    const barcodeId = `${formData.jobNumber}-${Date.now()}`;
    console.log('Generated barcode:', barcodeId);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header Section - matches image layout */}
      <div className="border-2 border-black p-4 mb-6">
        {/* Top row with page info */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-4">
            <div className="text-sm">
              <label className="font-semibold">Page:</label>
              <input
                type="text"
                value={formData.pageNumber}
                className="ml-2 w-8 border border-gray-400 px-1 text-center text-sm"
                readOnly
              />
            </div>
            <div className="text-sm">
              <label className="font-semibold">Job No:</label>
              <input
                type="text"
                value={formData.jobNumber}
                onChange={(e) => setFormData(prev => ({ ...prev, jobNumber: e.target.value }))}
                className="ml-2 w-24 border-b border-gray-400 px-1 text-sm font-semibold"
              />
            </div>
            <div className="text-sm">
              <label className="font-semibold">Date:</label>
              <input
                type="date"
                className="ml-2 border-b border-gray-400 px-1 text-sm"
              />
            </div>
          </div>
          <div className="text-right text-sm">
            <div>FORM: 12148</div>
          </div>
        </div>

        {/* Second row with customer and part info */}
        <div className="grid grid-cols-2 gap-8 mb-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-20">Cust. Code:</label>
              <input
                type="text"
                value={formData.customerCode}
                onChange={(e) => setFormData(prev => ({ ...prev, customerCode: e.target.value }))}
                className="flex-1 border-b border-gray-400 px-1 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-20">Cust Name:</label>
              <input
                type="text"
                value={formData.customerName}
                onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                className="flex-1 border-b border-gray-400 px-1 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-20">Part No:</label>
              <input
                type="text"
                value={formData.partNumber}
                onChange={(e) => setFormData(prev => ({ ...prev, partNumber: e.target.value }))}
                className="flex-1 border-b border-gray-400 px-1 text-sm font-semibold"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-20">PO Number:</label>
              <input
                type="text"
                value={formData.poNumber}
                onChange={(e) => setFormData(prev => ({ ...prev, poNumber: e.target.value }))}
                className="flex-1 border-b border-gray-400 px-1 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-20">Operation:</label>
              <input
                type="text"
                value={formData.operation}
                onChange={(e) => setFormData(prev => ({ ...prev, operation: e.target.value }))}
                className="w-16 border-b border-gray-400 px-1 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-16">Quantity:</label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: parseInt(e.target.value) }))}
                className="w-20 border-b border-gray-400 px-1 text-sm text-center font-semibold"
              />
              <span className="text-sm">ea.</span>
              <label className="font-semibold text-sm ml-4">Lot:</label>
              <input
                type="text"
                className="w-16 border-b border-gray-400 px-1 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-16">Part Rev:</label>
              <input
                type="text"
                value={formData.partRev}
                onChange={(e) => setFormData(prev => ({ ...prev, partRev: e.target.value }))}
                className="flex-1 border-b border-gray-400 px-1 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-16">Rev:</label>
              <input
                type="text"
                value={formData.revision}
                onChange={(e) => setFormData(prev => ({ ...prev, revision: e.target.value }))}
                className="w-16 border-b border-gray-400 px-1 text-sm font-semibold"
              />
              <span className="text-sm ml-4">Dwg #:</span>
              <input
                type="text"
                value={formData.drawingNumber}
                onChange={(e) => setFormData(prev => ({ ...prev, drawingNumber: e.target.value }))}
                className="w-20 border-b border-gray-400 px-1 text-sm"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="font-semibold text-sm w-16">Due Date:</label>
              <input
                type="date"
                className="border-b border-gray-400 px-1 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Specs Section */}
        <div className="border border-gray-400 p-2 mb-4">
          <div className="text-center font-bold text-sm mb-2 border-b border-gray-400 pb-1">SPECS</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-semibold">SOME PARTS CUSTOMER SUPPLY</div>
              <div>TWO MODIFICATIONS ADJ TO ASSY</div>
            </div>
            <div className="text-right">
              <input
                type="text"
                value={formData.specs}
                onChange={(e) => setFormData(prev => ({ ...prev, specs: e.target.value }))}
                className="w-full border-b border-gray-400 px-1 text-sm text-right"
              />
            </div>
          </div>
        </div>

        {/* Routing Section */}
        <div className="border border-gray-400">
          <div className="border-b border-gray-400 bg-gray-100 p-2">
            <div className="flex justify-between items-center">
              <div className="text-center font-bold text-sm flex-1">ROUTING</div>
              <div className="text-sm">{formData.routingNotes}</div>
            </div>
          </div>

          {/* Routing Table Header */}
          <div className="grid grid-cols-12 border-b border-gray-400 bg-gray-50 text-xs font-semibold">
            <div className="col-span-1 border-r border-gray-400 p-1 text-center">Seq</div>
            <div className="col-span-2 border-r border-gray-400 p-1 text-center">Work Center</div>
            <div className="col-span-3 border-r border-gray-400 p-1 text-center">Instructions</div>
            <div className="col-span-1 border-r border-gray-400 p-1 text-center">Quantity</div>
            <div className="col-span-1 border-r border-gray-400 p-1 text-center">Projected</div>
            <div className="col-span-1 border-r border-gray-400 p-1 text-center">Accepted</div>
            <div className="col-span-1 border-r border-gray-400 p-1 text-center">Seq</div>
            <div className="col-span-2 p-1 text-center">Date</div>
          </div>

          {/* Routing Table Rows */}
          {processSteps.map((step, index) => (
            <div key={step.id} className="grid grid-cols-12 border-b border-gray-400 text-xs min-h-[24px]">
              <div className="col-span-1 border-r border-gray-400 p-1 text-center">{step.stepNumber}</div>
              <div className="col-span-2 border-r border-gray-400 p-1">{step.operation}</div>
              <div className="col-span-3 border-r border-gray-400 p-1">{step.instructions}</div>
              <div className="col-span-1 border-r border-gray-400 p-1 text-center">{formData.quantity}</div>
              <div className="col-span-1 border-r border-gray-400 p-1 text-center">{formData.quantity}</div>
              <div className="col-span-1 border-r border-gray-400 p-1 text-center">
                <input type="checkbox" className="w-3 h-3" />
              </div>
              <div className="col-span-1 border-r border-gray-400 p-1"></div>
              <div className="col-span-2 p-1"></div>
            </div>
          ))}

          {/* Add empty rows for manual entry */}
          {[...Array(3)].map((_, index) => (
            <div key={`empty-${index}`} className="grid grid-cols-12 border-b border-gray-400 text-xs min-h-[24px]">
              <div className="col-span-1 border-r border-gray-400 p-1"></div>
              <div className="col-span-2 border-r border-gray-400 p-1"></div>
              <div className="col-span-3 border-r border-gray-400 p-1"></div>
              <div className="col-span-1 border-r border-gray-400 p-1"></div>
              <div className="col-span-1 border-r border-gray-400 p-1"></div>
              <div className="col-span-1 border-r border-gray-400 p-1"></div>
              <div className="col-span-1 border-r border-gray-400 p-1"></div>
              <div className="col-span-2 p-1"></div>
            </div>
          ))}
        </div>

        {/* Comments Section */}
        <div className="border-t border-gray-400 pt-2 mt-4">
          <div className="font-bold text-sm mb-1">COMMENTS</div>
          <textarea
            value={formData.comments}
            onChange={(e) => setFormData(prev => ({ ...prev, comments: e.target.value }))}
            className="w-full border border-gray-400 p-2 text-sm min-h-[60px]"
            placeholder="Enter comments here..."
          />
        </div>

        {/* Bottom signature area */}
        <div className="border-t border-gray-400 pt-2 mt-4 text-xs">
          <div className="flex justify-between">
            <div>
              <div className="font-semibold">Rework Total Asst: 2.50 - 11/25/84</div>
            </div>
            <div className="text-right">
              <div>Date</div>
              <div>11/25/84</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center space-x-4 mb-6">
        <button
          onClick={handlePrint}
          className="btn-primary flex items-center space-x-2 px-4 py-2 rounded-md"
        >
          <PrinterIcon className="h-5 w-5" />
          <span>Print Traveler</span>
        </button>

        <button
          onClick={generateBarcode}
          className="btn-secondary flex items-center space-x-2 px-4 py-2 rounded-md"
        >
          <QrCodeIcon className="h-5 w-5" />
          <span>Generate Barcode</span>
        </button>

        <button
          onClick={handleAutoPopulate}
          className="btn-secondary px-4 py-2 rounded-md"
        >
          Auto-Populate
        </button>

        <button
          type="submit"
          className="btn-primary px-6 py-2 rounded-md"
        >
          {mode === 'create' ? 'Create Traveler' : 'Update Traveler'}
        </button>
      </div>
    </div>
  );
}