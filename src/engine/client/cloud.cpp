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
	str_copy(m_aStatusMessage, "Not logged in", sizeof(m_aStatusMessage));
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
	str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Logging in as %s...", pUser);
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
	str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Registering as %s...", pUser);
	log_info("cloud", "Registering as %s...", pUser);
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

// Helper structure for folder upload callback
struct SFolderUploadContext
{
	CCloud *m_pCloud;
	char m_aFolderPath[512];
	int m_FileCount;
};

// Callback for directory listing
static int FolderUploadCallback(const char *pName, int IsDir, int StorageType, void *pUser)
{
	if(IsDir)
		return 0; // Skip directories
	
	SFolderUploadContext *pContext = (SFolderUploadContext *)pUser;
	
	// Build full relative path
	char aFullPath[512];
	str_format(aFullPath, sizeof(aFullPath), "%s/%s", pContext->m_aFolderPath, pName);
	
	// Upload the file
	pContext->m_pCloud->UploadAsset(aFullPath);
	pContext->m_FileCount++;
	
	return 0;
}

void CCloud::UploadAssetFolder(const char *pFolderPath)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	// Create context for callback
	SFolderUploadContext Context;
	Context.m_pCloud = this;
	str_copy(Context.m_aFolderPath, pFolderPath, sizeof(Context.m_aFolderPath));
	Context.m_FileCount = 0;
	
	// List all files in the directory
	m_pStorage->ListDirectory(IStorage::TYPE_ALL, pFolderPath, FolderUploadCallback, &Context);
	
	if(Context.m_FileCount > 0)
	{
		str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Uploading %d files from %s", Context.m_FileCount, pFolderPath);
		log_info("cloud", "Queued %d files from %s for upload", Context.m_FileCount, pFolderPath);
	}
	else
	{
		str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "No files found in %s", pFolderPath);
		log_warn("cloud", "No files found in folder: %s", pFolderPath);
	}
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
					str_copy(m_aStatusMessage, "Logged in successfully", sizeof(m_aStatusMessage));
					log_info("cloud", "Login successful");
					SyncSettings(false); // Auto-sync download
					GetInventory(); // Load inventory
				}
				else
				{
					str_copy(m_aStatusMessage, "Login failed: Invalid response", sizeof(m_aStatusMessage));
					log_error("cloud", "Login failed: Invalid response");
				}
				json_value_free(pJson);
			}
			else
			{
				str_copy(m_aStatusMessage, "Login failed: No response", sizeof(m_aStatusMessage));
				log_error("cloud", "Login failed: No response");
			}
		}
		else
		{
			str_copy(m_aStatusMessage, "Login failed: Request error", sizeof(m_aStatusMessage));
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
					str_copy(m_aStatusMessage, "Registered successfully", sizeof(m_aStatusMessage));
					log_info("cloud", "Registration successful");
					SyncSettings(false);
				}
				else
				{
					str_copy(m_aStatusMessage, "Registration failed", sizeof(m_aStatusMessage));
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
					str_copy(m_aStatusMessage, "Settings uploaded", sizeof(m_aStatusMessage));
					log_info("cloud", "Settings uploaded successfully");
				}
				else
				{
					m_pConfigManager->LoadFromJSON(pJson);
					// Save all config domains to disk
					m_pConfigManager->Save();
					str_copy(m_aStatusMessage, "Settings downloaded and applied", sizeof(m_aStatusMessage));
					log_info("cloud", "Settings downloaded, applied, and saved to disk");
				}
				json_value_free(pJson);
			}
			else
			{
				str_copy(m_aStatusMessage, "Settings sync failed", sizeof(m_aStatusMessage));
				log_error("cloud", "Settings sync failed: Invalid JSON");
			}
		}
		else
		{
			str_copy(m_aStatusMessage, "Settings sync failed", sizeof(m_aStatusMessage));
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
					log_info("cloud", "Asset operation completed");
					// Refresh inventory after upload
					GetInventory();
				}
			}
			else
			{
				log_error("cloud", "Asset operation failed");
			}
		}
		m_pAssetRequest = nullptr;
	}

	// Handle inventory request
	if(m_pInventoryRequest && m_pInventoryRequest->State() != EHttpState::QUEUED && m_pInventoryRequest->State() != EHttpState::RUNNING)
	{
		if(m_pInventoryRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pInventoryRequest.get())->ResultJson();
			if(pJson)
			{
				m_vInventory.clear();
				
				const json_value &Assets = (*pJson)["assets"];
				if(Assets.type == json_array)
				{
					for(unsigned i = 0; i < Assets.u.array.length; i++)
					{
						const json_value &Asset = Assets[i];
						SInventoryAsset Item;
						
						const json_value &Filename = Asset["filename"];
						const json_value &Version = Asset["latest_version"];
						const json_value &VersionCount = Asset["version_count"];
						const json_value &Size = Asset["total_size"];
						const json_value &Updated = Asset["last_updated"];
						
						if(Filename.type == json_string)
							str_copy(Item.m_aFilename, Filename.u.string.ptr, sizeof(Item.m_aFilename));
						Item.m_LatestVersion = (Version.type == json_integer) ? Version.u.integer : 0;
						Item.m_VersionCount = (VersionCount.type == json_integer) ? VersionCount.u.integer : 0;
						Item.m_TotalSize = (Size.type == json_integer) ? Size.u.integer : 0;
						if(Updated.type == json_string)
							str_copy(Item.m_aLastUpdated, Updated.u.string.ptr, sizeof(Item.m_aLastUpdated));
						
						m_vInventory.push_back(Item);
					}
					
					str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Inventory loaded: %d items", (int)m_vInventory.size());
					log_info("cloud", "Inventory loaded: %d items", (int)m_vInventory.size());
				}
				json_value_free(pJson);
			}
			else
			{
				str_copy(m_aStatusMessage, "Failed to load inventory", sizeof(m_aStatusMessage));
				log_error("cloud", "Failed to load inventory");
			}
		}
		else
		{
			str_copy(m_aStatusMessage, "Inventory request failed", sizeof(m_aStatusMessage));
			log_error("cloud", "Inventory request failed");
		}
		m_pInventoryRequest = nullptr;
	}
}

bool CCloud::IsLoggedIn() const
{
	return m_aToken[0] != 0;
}

const char *CCloud::GetStatusMessage() const
{
	return m_aStatusMessage;
}

void CCloud::GetInventory()
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/assets/inventory", BASE_URL);

	auto pRequest = HttpGet(aUrl);
	
	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);

	m_pInventoryRequest = std::move(pRequest);
	m_pHttp->Run(m_pInventoryRequest);
	str_copy(m_aStatusMessage, "Fetching inventory...", sizeof(m_aStatusMessage));
	log_info("cloud", "Fetching inventory...");
}

const CCloud::SInventoryAsset *CCloud::GetInventoryAsset(int Index) const
{
	if(Index < 0 || Index >= (int)m_vInventory.size())
		return nullptr;
	return &m_vInventory[Index];
}
