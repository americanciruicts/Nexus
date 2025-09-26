import barcode
from barcode.writer import ImageWriter
import io
import base64

def generate_barcode(traveler_number: str) -> str:
    """Generate a barcode for the traveler number"""
    try:
        code128 = barcode.get_barcode_class('code128')
        barcode_instance = code128(traveler_number, writer=ImageWriter())

        buffer = io.BytesIO()
        barcode_instance.write(buffer)
        buffer.seek(0)

        barcode_base64 = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/png;base64,{barcode_base64}"
    except Exception as e:
        print(f"Error generating barcode: {e}")
        return ""

def generate_qr_code(data: str) -> str:
    """Generate a QR code for the given data"""
    try:
        import qrcode
        from qrcode.image.pil import PilImage

        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(data)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)

        qr_base64 = base64.b64encode(buffer.getvalue()).decode()
        return f"data:image/png;base64,{qr_base64}"
    except Exception as e:
        print(f"Error generating QR code: {e}")
        return ""