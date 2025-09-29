import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy.orm import Session
from models import User, Traveler

# Email configuration
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

async def send_approval_notification(traveler_id: int, requested_by: str, request_type: str, db: Session):
    """Send email notification to Kris and Adam for approval requests"""

    try:
        # Get traveler details
        traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
        if not traveler:
            return False

        # Get approvers (Kris and Adam)
        approvers = db.query(User).filter(
            (User.username.in_(["Kris", "Adam"])) | (User.is_approver == True)
        ).all()

        if not approvers:
            print("No approvers found")
            return False

        # Create email content
        subject = f"NEXUS Approval Required - {request_type} Request"

        html_content = f"""
        <html>
        <head></head>
        <body>
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #1f2937; color: white; padding: 20px; text-align: center;">
                    <h1>NEXUS - Approval Required</h1>
                    <p>American Circuits Traveler Management System</p>
                </div>

                <div style="padding: 20px; background-color: #f9fafb;">
                    <h2>Approval Request Details</h2>

                    <div style="background-color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                        <p><strong>Request Type:</strong> {request_type}</p>
                        <p><strong>Requested By:</strong> {requested_by}</p>
                        <p><strong>Traveler ID:</strong> {traveler.id}</p>
                        <p><strong>Job Number:</strong> {traveler.job_number}</p>
                        <p><strong>Part Number:</strong> {traveler.part_number}</p>
                        <p><strong>Part Description:</strong> {traveler.part_description}</p>
                        <p><strong>Revision:</strong> {traveler.revision}</p>
                        <p><strong>Quantity:</strong> {traveler.quantity}</p>
                    </div>

                    <div style="text-align: center; margin-top: 30px;">
                        <p>Please log into NEXUS to review and approve this request.</p>
                        <a href="http://localhost:5000/approvals"
                           style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Review Request
                        </a>
                    </div>

                    <div style="margin-top: 30px; padding: 15px; background-color: #fef3c7; border-radius: 5px;">
                        <p style="margin: 0; color: #92400e;">
                            <strong>Note:</strong> This request requires approval from either Kris or Adam before it can be processed.
                        </p>
                    </div>
                </div>

                <div style="background-color: #374151; color: white; padding: 15px; text-align: center;">
                    <p style="margin: 0;">NEXUS - American Circuits Manufacturing</p>
                    <p style="margin: 0; font-size: 12px;">This is an automated notification from the NEXUS system.</p>
                </div>
            </div>
        </body>
        </html>
        """

        # Send email to each approver
        for approver in approvers:
            try:
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = SMTP_USERNAME
                msg['To'] = approver.email

                html_part = MIMEText(html_content, 'html')
                msg.attach(html_part)

                # Connect to SMTP server and send email
                if SMTP_USERNAME and SMTP_PASSWORD:
                    with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                        server.starttls()
                        server.login(SMTP_USERNAME, SMTP_PASSWORD)
                        server.send_message(msg)

                    print(f"Approval notification sent to {approver.email}")
                else:
                    print(f"Email would be sent to {approver.email} (SMTP not configured)")

            except Exception as e:
                print(f"Failed to send email to {approver.email}: {str(e)}")
                continue

        return True

    except Exception as e:
        print(f"Failed to send approval notifications: {str(e)}")
        return False

async def send_approval_decision(traveler_id: int, decision: str, approver_name: str, requester_email: str, db: Session):
    """Send email notification when approval is approved or rejected"""

    try:
        # Get traveler details
        traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
        if not traveler:
            return False

        status_color = "#10b981" if decision == "APPROVED" else "#ef4444"
        status_text = "Approved" if decision == "APPROVED" else "Rejected"

        subject = f"NEXUS Request {status_text} - Traveler #{traveler.job_number}"

        html_content = f"""
        <html>
        <head></head>
        <body>
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #1f2937; color: white; padding: 20px; text-align: center;">
                    <h1>NEXUS - Request {status_text}</h1>
                    <p>American Circuits Traveler Management System</p>
                </div>

                <div style="padding: 20px; background-color: #f9fafb;">
                    <div style="background-color: {status_color}; color: white; padding: 15px; border-radius: 5px; text-align: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">Request {status_text}</h2>
                    </div>

                    <div style="background-color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                        <p><strong>{status_text} By:</strong> {approver_name}</p>
                        <p><strong>Traveler ID:</strong> {traveler.id}</p>
                        <p><strong>Job Number:</strong> {traveler.job_number}</p>
                        <p><strong>Part Number:</strong> {traveler.part_number}</p>
                        <p><strong>Part Description:</strong> {traveler.part_description}</p>
                    </div>

                    <div style="text-align: center; margin-top: 30px;">
                        <a href="http://localhost:5000/travelers/{traveler.id}"
                           style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            View Traveler
                        </a>
                    </div>
                </div>

                <div style="background-color: #374151; color: white; padding: 15px; text-align: center;">
                    <p style="margin: 0;">NEXUS - American Circuits Manufacturing</p>
                    <p style="margin: 0; font-size: 12px;">This is an automated notification from the NEXUS system.</p>
                </div>
            </div>
        </body>
        </html>
        """

        # Send email
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = SMTP_USERNAME
            msg['To'] = requester_email

            html_part = MIMEText(html_content, 'html')
            msg.attach(html_part)

            if SMTP_USERNAME and SMTP_PASSWORD:
                with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                    server.starttls()
                    server.login(SMTP_USERNAME, SMTP_PASSWORD)
                    server.send_message(msg)

                print(f"Decision notification sent to {requester_email}")
            else:
                print(f"Email would be sent to {requester_email} (SMTP not configured)")

            return True

        except Exception as e:
            print(f"Failed to send decision email: {str(e)}")
            return False

    except Exception as e:
        print(f"Failed to send decision notification: {str(e)}")
        return False