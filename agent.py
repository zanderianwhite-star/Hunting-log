#!/usr/bin/env python3
"""
Email Spam Cleaner + Calendar Event Creator Agent
Uses Claude claude-opus-4-7 to intelligently manage Gmail inbox and create Google Calendar events.

Setup:
  1. Enable Gmail API and Google Calendar API in Google Cloud Console
  2. Download OAuth2 credentials as 'credentials.json' in this directory
  3. Set ANTHROPIC_API_KEY environment variable
  4. Run: pip install -r requirements.txt
  5. Run: python agent.py
"""

import os
import json
import base64
import datetime
from pathlib import Path

import anthropic
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
]

CREDENTIALS_FILE = Path(__file__).parent / "credentials.json"
TOKEN_FILE = Path(__file__).parent / "token.json"


def get_google_credentials() -> Credentials:
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                raise FileNotFoundError(
                    "credentials.json not found. Download OAuth2 credentials from "
                    "Google Cloud Console and save as credentials.json"
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())
    return creds


def build_services():
    creds = get_google_credentials()
    gmail = build("gmail", "v1", credentials=creds)
    calendar = build("calendar", "v3", credentials=creds)
    return gmail, calendar


# ── Gmail tools ──────────────────────────────────────────────────────────────

def list_inbox_emails(gmail_service, max_results: int = 20) -> list[dict]:
    result = gmail_service.users().messages().list(
        userId="me",
        labelIds=["INBOX"],
        maxResults=max_results,
    ).execute()
    messages = result.get("messages", [])
    emails = []
    for msg in messages:
        detail = gmail_service.users().messages().get(
            userId="me", id=msg["id"], format="metadata",
            metadataHeaders=["From", "Subject", "Date"],
        ).execute()
        headers = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
        emails.append({
            "id": msg["id"],
            "thread_id": detail.get("threadId"),
            "from": headers.get("From", ""),
            "subject": headers.get("Subject", ""),
            "date": headers.get("Date", ""),
            "snippet": detail.get("snippet", ""),
            "label_ids": detail.get("labelIds", []),
        })
    return emails


def move_to_spam(gmail_service, message_id: str) -> dict:
    gmail_service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"addLabelIds": ["SPAM"], "removeLabelIds": ["INBOX"]},
    ).execute()
    return {"status": "moved_to_spam", "message_id": message_id}


def delete_email(gmail_service, message_id: str) -> dict:
    gmail_service.users().messages().trash(userId="me", id=message_id).execute()
    return {"status": "trashed", "message_id": message_id}


def mark_as_read(gmail_service, message_id: str) -> dict:
    gmail_service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"removeLabelIds": ["UNREAD"]},
    ).execute()
    return {"status": "marked_read", "message_id": message_id}


# ── Calendar tools ────────────────────────────────────────────────────────────

def create_calendar_event(
    calendar_service,
    title: str,
    start_datetime: str,
    end_datetime: str,
    description: str = "",
    location: str = "",
    timezone: str = "America/New_York",
) -> dict:
    """
    Creates a Google Calendar event.
    start_datetime / end_datetime: ISO 8601 format, e.g. '2025-06-15T14:00:00'
    """
    event = {
        "summary": title,
        "description": description,
        "location": location,
        "start": {"dateTime": start_datetime, "timeZone": timezone},
        "end": {"dateTime": end_datetime, "timeZone": timezone},
    }
    created = calendar_service.events().insert(calendarId="primary", body=event).execute()
    return {
        "status": "created",
        "event_id": created["id"],
        "html_link": created.get("htmlLink", ""),
        "summary": created.get("summary", ""),
        "start": created["start"],
        "end": created["end"],
    }


def list_upcoming_events(calendar_service, max_results: int = 10) -> list[dict]:
    now = datetime.datetime.utcnow().isoformat() + "Z"
    result = calendar_service.events().list(
        calendarId="primary",
        timeMin=now,
        maxResults=max_results,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    items = result.get("items", [])
    return [
        {
            "id": e["id"],
            "summary": e.get("summary", ""),
            "start": e.get("start", {}),
            "end": e.get("end", {}),
            "description": e.get("description", ""),
            "location": e.get("location", ""),
        }
        for e in items
    ]


# ── Tool definitions for Claude ───────────────────────────────────────────────

TOOLS = [
    {
        "name": "list_inbox_emails",
        "description": (
            "Retrieves emails from the Gmail inbox. Returns sender, subject, date, "
            "snippet, and label info for each email. Use this to inspect what's in "
            "the inbox before deciding which emails are spam."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of emails to retrieve (default 20, max 50).",
                    "default": 20,
                }
            },
        },
    },
    {
        "name": "move_to_spam",
        "description": (
            "Moves a specific email to the Spam folder and removes it from the Inbox. "
            "Use this when you identify an email as spam or unwanted promotional content."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The Gmail message ID of the email to mark as spam.",
                }
            },
            "required": ["message_id"],
        },
    },
    {
        "name": "delete_email",
        "description": (
            "Moves an email to the Trash. Use for clearly unwanted emails that are "
            "not worth keeping even in Spam."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The Gmail message ID of the email to trash.",
                }
            },
            "required": ["message_id"],
        },
    },
    {
        "name": "mark_as_read",
        "description": "Marks an email as read without moving or deleting it.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The Gmail message ID to mark as read.",
                }
            },
            "required": ["message_id"],
        },
    },
    {
        "name": "create_calendar_event",
        "description": (
            "Creates a new event in Google Calendar. Use this when the user asks to "
            "schedule a meeting, appointment, reminder, or any calendar event."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title/summary."},
                "start_datetime": {
                    "type": "string",
                    "description": "Start time in ISO 8601 format, e.g. '2025-06-15T14:00:00'.",
                },
                "end_datetime": {
                    "type": "string",
                    "description": "End time in ISO 8601 format, e.g. '2025-06-15T15:00:00'.",
                },
                "description": {
                    "type": "string",
                    "description": "Optional event description or notes.",
                    "default": "",
                },
                "location": {
                    "type": "string",
                    "description": "Optional location for the event.",
                    "default": "",
                },
                "timezone": {
                    "type": "string",
                    "description": "Timezone for the event, e.g. 'America/New_York'.",
                    "default": "America/New_York",
                },
            },
            "required": ["title", "start_datetime", "end_datetime"],
        },
    },
    {
        "name": "list_upcoming_events",
        "description": "Lists upcoming events from Google Calendar.",
        "input_schema": {
            "type": "object",
            "properties": {
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of upcoming events to return (default 10).",
                    "default": 10,
                }
            },
        },
    },
]


# ── Tool dispatcher ───────────────────────────────────────────────────────────

def dispatch_tool(name: str, inputs: dict, gmail, calendar) -> str:
    if name == "list_inbox_emails":
        result = list_inbox_emails(gmail, inputs.get("max_results", 20))
        return json.dumps(result, indent=2)

    elif name == "move_to_spam":
        result = move_to_spam(gmail, inputs["message_id"])
        return json.dumps(result)

    elif name == "delete_email":
        result = delete_email(gmail, inputs["message_id"])
        return json.dumps(result)

    elif name == "mark_as_read":
        result = mark_as_read(gmail, inputs["message_id"])
        return json.dumps(result)

    elif name == "create_calendar_event":
        result = create_calendar_event(
            calendar,
            title=inputs["title"],
            start_datetime=inputs["start_datetime"],
            end_datetime=inputs["end_datetime"],
            description=inputs.get("description", ""),
            location=inputs.get("location", ""),
            timezone=inputs.get("timezone", "America/New_York"),
        )
        return json.dumps(result)

    elif name == "list_upcoming_events":
        result = list_upcoming_events(calendar, inputs.get("max_results", 10))
        return json.dumps(result, indent=2)

    else:
        return json.dumps({"error": f"Unknown tool: {name}"})


# ── Agent loop ────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a helpful assistant that manages Gmail and Google Calendar.

You can:
1. **Clean spam from Gmail inbox** — List inbox emails, identify spam/promotional/unwanted
   messages, and move them to Spam or Trash. Be conservative: only move clearly unwanted
   messages. Never move emails from known contacts, important services, or anything the
   user might want to keep.

2. **Create calendar events** — Schedule meetings, appointments, reminders, and other
   events in Google Calendar.

When cleaning spam, always list emails first, explain what you found, describe what you
plan to do, then take action. Report a summary when done.

Today's date is """ + datetime.date.today().isoformat() + "."


def run_agent(user_message: str, gmail, calendar, client: anthropic.Anthropic):
    messages = [{"role": "user", "content": user_message}]

    print(f"\n{'='*60}")
    print(f"User: {user_message}")
    print(f"{'='*60}\n")

    while True:
        response = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Print any text responses as they come
        for block in response.content:
            if block.type == "text":
                print(f"Agent: {block.text}\n")

        # If done, break
        if response.stop_reason == "end_turn":
            break

        # Handle tool calls
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    print(f"[Tool] {block.name}({json.dumps(block.input, separators=(',', ':'))})")
                    result = dispatch_tool(block.name, block.input, gmail, calendar)
                    print(f"[Result] {result[:200]}{'...' if len(result) > 200 else ''}\n")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            # Append assistant response + tool results and continue
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        else:
            break


# ── Main interactive loop ─────────────────────────────────────────────────────

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("Set the ANTHROPIC_API_KEY environment variable.")

    print("Connecting to Google services...")
    gmail, calendar = build_services()
    print("Connected.\n")

    client = anthropic.Anthropic(api_key=api_key)

    print("Email Spam & Calendar Agent")
    print("Commands:")
    print("  'clean spam'  — Scan inbox and remove spam")
    print("  'create event <details>'  — Create a calendar event")
    print("  'list events' — Show upcoming calendar events")
    print("  Or ask anything naturally.")
    print("  Type 'quit' to exit.\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("Goodbye!")
            break

        run_agent(user_input, gmail, calendar, client)


if __name__ == "__main__":
    main()
