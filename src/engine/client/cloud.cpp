#include "cloud.h"
#include <engine/external/json-parser/json.h>
#include <engine/shared/jsonwriter.h>
#include <engine/shared/http.h>
#include <base/system.h>
#include <base/log.h>

static const char *BASE_URL = "http://localhost:3000/api";

CCloud::CCloud(IClient *pClient, IEngine *pEngine, IHttp *pHttp, IStorage *pStorage, IConfigManager *pConfigManager) :
	m_pClient(pClient),
	m_pEngine(pEngine),
	m_pHttp(pHttp),
	m_pStorage(pStorage),
	m_pConfigManager(pConfigManager)
{
	m_aToken[0] = 0;
	m_aUsername[0] = 0;
	m_UploadSettings = false;
}

void CCloud::Login(const char *pUser, const char *pPass)
{
	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/auth/login", BASE_URL);

	CJsonStringWriter Writer;
	Writer.BeginObject();
	Writer.WriteAttribute("username");
	Writer.WriteStrValue(pUser);
	Writer.WriteAttribute("password");
	Writer.WriteStrValue(pPass);
	Writer.EndObject();

	m_pLoginRequest = std::move(HttpPostJson(aUrl, Writer.GetOutputString().c_str()));
	m_pHttp->Run(m_pLoginRequest);
	log_info("cloud", "Logging in as %s...", pUser);
}

void CCloud::Register(const char *pUser, const char *pPass)
{
	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/auth/register", BASE_URL);

	CJsonStringWriter Writer;
	Writer.BeginObject();
	Writer.WriteAttribute("username");
	Writer.WriteStrValue(pUser);
	Writer.WriteAttribute("password");
	Writer.WriteStrValue(pPass);
	Writer.EndObject();

	m_pRegisterRequest = std::move(HttpPostJson(aUrl, Writer.GetOutputString().c_str()));
	m_pHttp->Run(m_pRegisterRequest);
	log_info("cloud", "Registering %s...", pUser);
}

void CCloud::SyncSettings(bool Upload)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/settings", BASE_URL);

	m_UploadSettings = Upload;
	std::shared_ptr<CHttpRequest> pRequest;

	if(Upload)
	{
		std::string Json = m_pConfigManager->SaveToJSON();
		// Wrap in "settings" object if needed, but SaveToJSON already does that?
		// SaveToJSON returns { "settings": { ... } }
		// Backend expects { "settings": { ... } }
		// So it matches.
		pRequest = std::move(HttpPostJson(aUrl, Json.c_str()));
	}
	else
	{
		pRequest = std::move(HttpGet(aUrl));
	}
	
	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);

	m_pSettingsRequest = pRequest;
	m_pHttp->Run(m_pSettingsRequest);
	log_info("cloud", "Syncing settings (%s)...", Upload ? "Upload" : "Download");
}

void CCloud::UploadAsset(const char *pFilename)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	void *pBuf;
	unsigned Length;
	if(!m_pStorage->ReadFile(pFilename, IStorage::TYPE_ALL, &pBuf, &Length))
	{
		log_error("cloud", "Failed to read asset file: %s", pFilename);
		return;
	}

	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/assets", BASE_URL);

	auto pRequest = HttpPost(aUrl, (const unsigned char *)pBuf, Length);
	free(pBuf);

	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);
	pRequest->HeaderString("X-Filename", pFilename);
	pRequest->HeaderString("Content-Type", "application/octet-stream");

	m_pAssetRequest = std::move(pRequest);
	m_pHttp->Run(m_pAssetRequest);
	log_info("cloud", "Uploading asset: %s...", pFilename);
}

void CCloud::DownloadAsset(const char *pFilename)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	char aUrl[256];
	char aEscaped[256];
	EscapeUrl(aEscaped, pFilename);
	str_format(aUrl, sizeof(aUrl), "%s/assets/%s", BASE_URL, aEscaped);

	auto pRequest = HttpGet(aUrl);
	
	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);

	m_pAssetRequest = std::move(pRequest);
	m_pHttp->Run(m_pAssetRequest);
	log_info("cloud", "Downloading asset: %s...", pFilename);
}

void CCloud::Update()
{
	if(m_pLoginRequest && m_pLoginRequest->State() != EHttpState::QUEUED && m_pLoginRequest->State() != EHttpState::RUNNING)
	{
		if(m_pLoginRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pLoginRequest.get())->ResultJson();
			if(pJson)
			{
				const json_value &Token = (*pJson)["token"];
				if(Token.type == json_string)
				{
					str_copy(m_aToken, Token.u.string.ptr, sizeof(m_aToken));
					log_info("cloud", "Login successful");
					SyncSettings(false); // Auto-sync download
				}
				else
				{
					log_error("cloud", "Login failed: Invalid response");
				}
				json_value_free(pJson);
			}
			else
			{
				log_error("cloud", "Login failed: No response");
			}
		}
		else
		{
			log_error("cloud", "Login failed: Request error");
		}
		m_pLoginRequest = nullptr;
	}

	if(m_pRegisterRequest && m_pRegisterRequest->State() != EHttpState::QUEUED && m_pRegisterRequest->State() != EHttpState::RUNNING)
	{
		if(m_pRegisterRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pRegisterRequest.get())->ResultJson();
			if(pJson)
			{
				const json_value &Token = (*pJson)["token"];
				if(Token.type == json_string)
				{
					str_copy(m_aToken, Token.u.string.ptr, sizeof(m_aToken));
					log_info("cloud", "Registration successful");
					SyncSettings(false);
				}
				else
				{
					log_error("cloud", "Registration failed");
				}
				json_value_free(pJson);
			}
		}
		m_pRegisterRequest = nullptr;
	}

	if(m_pSettingsRequest && m_pSettingsRequest->State() != EHttpState::QUEUED && m_pSettingsRequest->State() != EHttpState::RUNNING)
	{
		if(m_pSettingsRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pSettingsRequest.get())->ResultJson();
			if(pJson)
			{
				if(m_UploadSettings)
				{
					log_info("cloud", "Settings uploaded successfully");
				}
				else
				{
					m_pConfigManager->LoadFromJSON(pJson);
					log_info("cloud", "Settings downloaded and applied");
				}
				json_value_free(pJson);
			}
			else
			{
				log_error("cloud", "Settings sync failed: Invalid JSON");
			}
		}
		else
		{
			log_error("cloud", "Settings sync failed: Request error");
		}
		m_pSettingsRequest = nullptr;
	}

	if(m_pAssetRequest && m_pAssetRequest->State() != EHttpState::QUEUED && m_pAssetRequest->State() != EHttpState::RUNNING)
	{
		if(m_pAssetRequest->State() == EHttpState::DONE)
		{
			unsigned char *pData;
			size_t DataSize;
			((CHttpRequest*)m_pAssetRequest.get())->Result(&pData, &DataSize);

			if(DataSize > 0)
			{
				json_value *pJson = ((CHttpRequest*)m_pAssetRequest.get())->ResultJson();
				if(pJson && pJson->type == json_object)
				{
					const json_value &Msg = (*pJson)["message"];
					if(Msg.type == json_string)
						log_info("cloud", "Asset operation successful: %s", Msg.u.string.ptr);
					json_value_free(pJson);
				}
				else
				{
					log_info("cloud", "Asset downloaded (%d bytes)", (int)DataSize);
					// For now, we'll just save it to "downloaded_asset" if we don't have the name
					IOHANDLE File = m_pStorage->OpenFile("downloaded_asset", IOFLAG_WRITE, IStorage::TYPE_SAVE);
					if(File)
					{
						io_write(File, pData, DataSize);
						io_close(File);
					}
				}
			}
			else
			{
				log_info("cloud", "Asset operation completed");
			}
		}
		else
		{
			log_error("cloud", "Asset operation failed");
		}
		m_pAssetRequest = nullptr;
	}
}
