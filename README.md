<p align="center">
  <h1 align="center">MAMA Disaster Response</h1>
  <h3 align="center"><em>Africa Early Warning System. From weather data to WhatsApp alert in minutes.</em></h3>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/cost-Free_Forever-green" alt="Free">
  <img src="https://img.shields.io/badge/status-Active-brightgreen" alt="Active">
  <a href="https://mama.oliwoods.ai"><img src="https://img.shields.io/badge/Built_with-MAMA-8b5cf6" alt="Built with MAMA"></a>
  <a href="https://cofounder.software"><img src="https://img.shields.io/badge/Powered_by-CoFounder-06b6d4" alt="Powered by CoFounder"></a>
  <a href="https://oliwoodsfoundation.org"><img src="https://img.shields.io/badge/OliWoods-Foundation-10b981" alt="OliWoods Foundation"></a>
</p>

---

> **2,000+ weather-related deaths** annually in Sub-Saharan Africa. Community warning systems rely on radio and word-of-mouth. The gap between weather data and community action is where people die.

## The Solution

4 AI agents that ingest weather data, generate context-aware alerts, and deliver to communities via WhatsApp. Human-in-the-loop approval before any alert goes out.

## Agents

**WeatherIngestion** — Pull from weather APIs (NWS, NOAA, local met services)
**AlertGeneration** — Context-aware alert creation with severity and action items
**WhatsAppDelivery** — Deliver alerts via Twilio WhatsApp to community leaders
**GovernmentDashboard** — County coordinator dashboard for monitoring and response

## Safety

Human-in-the-loop: NO alert goes out without explicit approval from a verified coordinator. False alarms erode trust and cost lives.

## Data Sources

National weather services APIs, NOAA data, satellite imagery

## Quick Start

```bash
git clone https://github.com/OliWoods-Org/mama-disaster-response.git
cd mama-disaster-response
```

Or use via [MAMA](https://mama.oliwoods.ai) — available as a free marketplace pack.

## Contributing

Meteorologists, disaster response experts, WhatsApp/Twilio developers, African country specialists

1. Fork the repo
2. Create a feature branch
3. Commit and open a PR

## Related Projects

| Project | Description |
|---------|-------------|
| [MAMA](https://mama.oliwoods.ai) | AI Chief of Staff — 85+ agent teams |
| [CoFounder](https://cofounder.software) | AI agent marketplace |
| [MAMA AI Clinic](https://github.com/OliWoods-Org/mama-ai-clinic) | $170 offline health clinic for Raspberry Pi |

---

<p align="center">
  <strong>An <a href="https://oliwoodsfoundation.org">OliWoods Foundation</a> Project</strong>
  <br><em>Open-source AI for humanitarian impact</em>
  <br><br>
  <sub>Built with <a href="https://mama.oliwoods.ai">MAMA</a> · Powered by <a href="https://cofounder.software">CoFounder</a><br>GPL-3.0 — Fork it. Deploy it. Make an impact.</sub>
</p>
