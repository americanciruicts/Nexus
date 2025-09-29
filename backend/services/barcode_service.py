import os
import qrcode
from barcode import Code128
from barcode.writer import ImageWriter
from io import BytesIO
import base64
from PIL import Image

class BarcodeService:
    """Service for generating barcodes and QR codes for travelers"""

    @staticmethod
    def generate_traveler_barcode(traveler_id: int, job_number: str) -> str:
        """Generate a unique barcode for a traveler"""
        # Create unique identifier combining traveler ID and job number
        barcode_data = f"NEX-{traveler_id:06d}-{job_number}"

        try:
            # Generate Code128 barcode
            code128 = Code128(barcode_data, writer=ImageWriter())
            buffer = BytesIO()
            code128.write(buffer)

            # Convert to base64 for easy storage and transmission
            buffer.seek(0)
            barcode_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

            return barcode_base64

        except Exception as e:
            print(f"Error generating barcode: {str(e)}")
            return ""

    @staticmethod
    def generate_qr_code(traveler_id: int, job_number: str, part_number: str) -> str:
        """Generate a QR code containing traveler information"""
        qr_data = {
            "traveler_id": traveler_id,
            "job_number": job_number,
            "part_number": part_number,
            "system": "NEXUS",
            "company": "American Circuits"
        }

        # Convert to string format for QR code
        qr_string = f"NEXUS|{traveler_id}|{job_number}|{part_number}|AC"

        try:
            # Generate QR code
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=4,
            )
            qr.add_data(qr_string)
            qr.make(fit=True)

            # Create QR code image
            qr_image = qr.make_image(fill_color="black", back_color="white")

            # Convert to base64
            buffer = BytesIO()
            qr_image.save(buffer, format='PNG')
            buffer.seek(0)
            qr_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

            return qr_base64

        except Exception as e:
            print(f"Error generating QR code: {str(e)}")
            return ""

    @staticmethod
    def parse_barcode(barcode_data: str) -> dict:
        """Parse barcode data to extract traveler information"""
        try:
            # Expected format: NEX-XXXXXX-JOBNUMBER
            if not barcode_data.startswith("NEX-"):
                return {"error": "Invalid barcode format"}

            parts = barcode_data.split("-")
            if len(parts) < 3:
                return {"error": "Invalid barcode structure"}

            traveler_id = int(parts[1])
            job_number = "-".join(parts[2:])  # Join remaining parts as job number

            return {
                "traveler_id": traveler_id,
                "job_number": job_number,
                "valid": True
            }

        except Exception as e:
            return {"error": f"Failed to parse barcode: {str(e)}"}

    @staticmethod
    def parse_qr_code(qr_data: str) -> dict:
        """Parse QR code data to extract traveler information"""
        try:
            # Expected format: NEXUS|traveler_id|job_number|part_number|AC
            parts = qr_data.split("|")
            if len(parts) < 5 or parts[0] != "NEXUS":
                return {"error": "Invalid QR code format"}

            return {
                "system": parts[0],
                "traveler_id": int(parts[1]),
                "job_number": parts[2],
                "part_number": parts[3],
                "company": parts[4],
                "valid": True
            }

        except Exception as e:
            return {"error": f"Failed to parse QR code: {str(e)}"}

    @staticmethod
    def generate_traveler_label(traveler_data: dict) -> str:
        """Generate a complete traveler label with barcode, QR code, and information"""
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import letter
            from reportlab.lib.units import inch

            buffer = BytesIO()
            p = canvas.Canvas(buffer, pagesize=(4*inch, 6*inch))  # 4x6 label size

            # Title
            p.setFont("Helvetica-Bold", 16)
            p.drawString(0.25*inch, 5.5*inch, "NEXUS TRAVELER")

            # Company info
            p.setFont("Helvetica", 12)
            p.drawString(0.25*inch, 5.2*inch, "American Circuits")

            # Traveler information
            p.setFont("Helvetica-Bold", 10)
            p.drawString(0.25*inch, 4.8*inch, f"Job Number: {traveler_data['job_number']}")
            p.drawString(0.25*inch, 4.6*inch, f"Part Number: {traveler_data['part_number']}")
            p.drawString(0.25*inch, 4.4*inch, f"Description: {traveler_data['part_description']}")
            p.drawString(0.25*inch, 4.2*inch, f"Revision: {traveler_data['revision']}")
            p.drawString(0.25*inch, 4.0*inch, f"Quantity: {traveler_data['quantity']}")

            # Barcode area (would need actual barcode image insertion)
            p.setFont("Helvetica", 8)
            p.drawString(0.25*inch, 3.6*inch, "Barcode:")
            p.rect(0.25*inch, 2.8*inch, 3.5*inch, 0.6*inch)

            # Traveler ID
            p.setFont("Helvetica-Bold", 12)
            p.drawString(0.25*inch, 2.4*inch, f"Traveler ID: {traveler_data['traveler_id']}")

            # QR Code area
            p.setFont("Helvetica", 8)
            p.drawString(0.25*inch, 2.0*inch, "QR Code:")
            p.rect(0.25*inch, 0.5*inch, 1.5*inch, 1.5*inch)

            # Footer
            p.setFont("Helvetica", 8)
            p.drawString(0.25*inch, 0.25*inch, f"Generated: {traveler_data.get('created_at', 'N/A')}")

            p.save()
            buffer.seek(0)
            pdf_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

            return pdf_base64

        except Exception as e:
            print(f"Error generating traveler label: {str(e)}")
            return ""

    @staticmethod
    def generate_unique_traveler_id() -> str:
        """Generate a unique traveler identifier"""
        import uuid
        import datetime

        # Create unique ID with timestamp and random component
        now = datetime.datetime.now()
        unique_id = f"{now.strftime('%y%m%d')}{now.strftime('%H%M%S')}{str(uuid.uuid4())[:6].upper()}"

        return unique_id